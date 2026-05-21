from __future__ import annotations

import shutil
import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from mediafiles.models import MediaFile, MediaType
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import CheckInProtocol, Loan, LoanStatus, ManufacturerCheckOutProtocol
from workflows.pdf import (
    CHECK_IN_DOCUMENT,
    LOAN_CHECKOUT_DOCUMENT,
    LOAN_RETURN_DOCUMENT,
    MANUFACTURER_CHECKOUT_DOCUMENT,
)


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_BYTES = b"\xff\xd8\xff" + b"\x00" * 32
MEDIA_UPLOAD_ROOT = tempfile.mkdtemp(prefix="fleet-media-tests-")
PDF_MEDIA_ROOT = tempfile.mkdtemp(prefix="fleet-pdf-tests-")


@override_settings(MEDIA_ROOT=MEDIA_UPLOAD_ROOT, MAX_UPLOAD_SIZE_MB=1)
class MediaUploadAPITests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_UPLOAD_ROOT, ignore_errors=True)

    def setUp(self):
        user_model = get_user_model()
        self.operations_user = user_model.objects.create_user(username="ops", password="secret", role="operations")
        self.readonly_user = user_model.objects.create_user(username="reader", password="secret", role="readonly")
        self.category = VehicleCategory.objects.create(name="Steiger")
        self.vehicle = Vehicle.objects.create(
            internal_number="VH-MEDIA",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            status=VehicleStatus.AVAILABLE,
        )

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_photo_upload_persists_file_and_authenticated_download_streams_it(self):
        response = self.client_for(self.operations_user).post(
            "/api/v1/media/",
            {
                "file": SimpleUploadedFile("damage.png", PNG_BYTES, content_type="image/png"),
                "media_type": MediaType.PHOTO,
                "vehicle": str(self.vehicle.id),
                "related_type": "vehicle",
                "related_id": str(self.vehicle.id),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = MediaFile.objects.get()
        self.assertEqual(media.vehicle, self.vehicle)
        self.assertEqual(media.media_type, MediaType.PHOTO)
        self.assertTrue(default_storage.exists(media.storage_key))
        self.assertEqual(response.data["download_url"], f"http://testserver/api/v1/media/{media.id}/download/")

        anonymous_response = APIClient().get(f"/api/v1/media/{media.id}/download/")
        download_response = self.client_for(self.readonly_user).get(f"/api/v1/media/{media.id}/download/")

        self.assertEqual(anonymous_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(download_response.status_code, status.HTTP_200_OK)
        self.assertEqual(download_response["Content-Type"], "image/png")
        self.assertEqual(b"".join(download_response.streaming_content), PNG_BYTES)

    def test_upload_rejects_mismatched_content_and_oversized_files(self):
        mismatch_response = self.client_for(self.operations_user).post(
            "/api/v1/media/",
            {
                "file": SimpleUploadedFile("bad.png", b"not an image", content_type="image/png"),
                "media_type": MediaType.PHOTO,
                "vehicle": str(self.vehicle.id),
            },
            format="multipart",
        )
        oversized_response = self.client_for(self.operations_user).post(
            "/api/v1/media/",
            {
                "file": SimpleUploadedFile("large.jpg", JPEG_BYTES + b"0" * (1024 * 1024), content_type="image/jpeg"),
                "media_type": MediaType.PHOTO,
                "vehicle": str(self.vehicle.id),
            },
            format="multipart",
        )

        self.assertEqual(mismatch_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(oversized_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MediaFile.objects.count(), 0)


@override_settings(MEDIA_ROOT=PDF_MEDIA_ROOT)
class PDFProtocolAPITests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(PDF_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        user_model = get_user_model()
        self.operations_user = user_model.objects.create_user(username="ops", password="secret", role="operations")
        self.category = VehicleCategory.objects.create(name="Steiger")
        self.company = Company.objects.create(name="SubCo", company_type="subcontractor")
        self.manufacturer = Company.objects.create(name="Maker", company_type="manufacturer")
        self.vehicle = Vehicle.objects.create(
            internal_number="VH-PDF",
            category=self.category,
            manufacturer="Acme",
            model="TH100",
            serial_number="SN-PDF",
            license_plate="LP-PDF",
            status=VehicleStatus.AVAILABLE,
            current_odometer_km=100,
            current_operating_hours="10.0",
        )

    def api_client(self):
        client = APIClient()
        client.force_authenticate(user=self.operations_user)
        return client

    def assert_pdf_media(self, media_id: str, *, language: str, related_type: str, related_id) -> MediaFile:
        media = MediaFile.objects.get(pk=media_id)
        self.assertEqual(media.media_type, MediaType.PDF)
        self.assertEqual(media.language, language)
        self.assertEqual(media.related_type, related_type)
        self.assertEqual(media.related_id, related_id)
        self.assertTrue(default_storage.exists(media.storage_key))
        with default_storage.open(media.storage_key, "rb") as stored_file:
            self.assertTrue(stored_file.read(4).startswith(b"%PDF"))
        return media

    def test_check_in_pdf_is_generated_in_german_and_english_without_overwriting(self):
        protocol = CheckInProtocol.objects.create(
            vehicle=self.vehicle,
            performed_by=self.operations_user,
            supplier_company=self.manufacturer,
            odometer_km=120,
            operating_hours="12.5",
            condition_notes="Visible scratch",
        )

        de_response = self.api_client().post(
            f"/api/v1/workflows/check-ins/{protocol.id}/generate-pdf/", {"language": "de"}, format="json"
        )
        repeat_de_response = self.api_client().post(
            f"/api/v1/workflows/check-ins/{protocol.id}/generate-pdf/", {"language": "de"}, format="json"
        )
        en_response = self.api_client().post(
            f"/api/v1/workflows/check-ins/{protocol.id}/generate-pdf/", {"language": "en"}, format="json"
        )

        self.assertEqual(de_response.status_code, status.HTTP_200_OK)
        self.assertEqual(repeat_de_response.status_code, status.HTTP_200_OK)
        self.assertEqual(en_response.status_code, status.HTTP_200_OK)
        self.assertEqual(repeat_de_response.data["id"], de_response.data["id"])
        de_media = self.assert_pdf_media(
            de_response.data["id"], language="de", related_type=CHECK_IN_DOCUMENT, related_id=protocol.id
        )
        self.assert_pdf_media(en_response.data["id"], language="en", related_type=CHECK_IN_DOCUMENT, related_id=protocol.id)
        protocol.refresh_from_db()
        self.assertEqual(protocol.pdf_media, de_media)
        self.assertEqual(protocol.pdf_language, "de")
        self.assertEqual(
            MediaFile.objects.filter(related_type=CHECK_IN_DOCUMENT, related_id=protocol.id, media_type=MediaType.PDF).count(),
            2,
        )

    def test_loan_and_manufacturer_pdf_endpoints_link_generated_documents(self):
        loan = Loan.objects.create(
            vehicle=self.vehicle,
            company=self.company,
            borrower_name="Borrower",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            checkout_odometer_km=110,
            checkout_operating_hours="11.0",
            checkout_notes="Checkout ok",
            actual_return_at=timezone.now(),
            status=LoanStatus.RETURNED,
            return_odometer_km=130,
            return_operating_hours="13.0",
            return_notes="Returned ok",
            created_by=self.operations_user,
            returned_by=self.operations_user,
        )
        manufacturer_protocol = ManufacturerCheckOutProtocol.objects.create(
            vehicle=self.vehicle,
            performed_by=self.operations_user,
            recipient_company=self.manufacturer,
            odometer_km=140,
            operating_hours="14.0",
            condition_notes="Manufacturer handoff",
        )

        checkout_response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/generate-checkout-pdf/", {"language": "en"}, format="json"
        )
        return_response = self.api_client().post(
            f"/api/v1/loans/{loan.id}/generate-return-pdf/", {"language": "de"}, format="json"
        )
        manufacturer_response = self.api_client().post(
            f"/api/v1/workflows/manufacturer-checkouts/{manufacturer_protocol.id}/generate-pdf/",
            {"language": "en"},
            format="json",
        )

        self.assertEqual(checkout_response.status_code, status.HTTP_200_OK)
        self.assertEqual(return_response.status_code, status.HTTP_200_OK)
        self.assertEqual(manufacturer_response.status_code, status.HTTP_200_OK)
        checkout_media = self.assert_pdf_media(
            checkout_response.data["id"], language="en", related_type=LOAN_CHECKOUT_DOCUMENT, related_id=loan.id
        )
        return_media = self.assert_pdf_media(
            return_response.data["id"], language="de", related_type=LOAN_RETURN_DOCUMENT, related_id=loan.id
        )
        manufacturer_media = self.assert_pdf_media(
            manufacturer_response.data["id"],
            language="en",
            related_type=MANUFACTURER_CHECKOUT_DOCUMENT,
            related_id=manufacturer_protocol.id,
        )
        loan.refresh_from_db()
        manufacturer_protocol.refresh_from_db()
        self.assertEqual(loan.checkout_pdf_media, checkout_media)
        self.assertEqual(loan.checkout_pdf_language, "en")
        self.assertEqual(loan.return_pdf_media, return_media)
        self.assertEqual(loan.return_pdf_language, "de")
        self.assertEqual(manufacturer_protocol.pdf_media, manufacturer_media)
        self.assertEqual(manufacturer_protocol.pdf_language, "en")

    def test_document_download_endpoint_serves_generated_pdf(self):
        protocol = CheckInProtocol.objects.create(vehicle=self.vehicle, performed_by=self.operations_user)
        generate_response = self.api_client().post(
            f"/api/v1/workflows/check-ins/{protocol.id}/generate-pdf/", {"language": "en"}, format="json"
        )

        response = self.api_client().get(f"/api/v1/documents/{generate_response.data['id']}/download/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))
