from __future__ import annotations

import shutil
import tempfile
import threading
from unittest import skipUnless
from datetime import timedelta
from io import BytesIO

from PIL import Image as PillowImage
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.core.management import call_command
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from openpyxl import Workbook
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from damages.models import DamageReport
from drivers.models import Driver
from mediafiles.models import MediaFile, MediaType
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import (
    CheckInProtocol,
    ConditionOutcome,
    Loan,
    LoanStatus,
    MaintenanceRecord,
    MaintenanceStatus,
    Reservation,
    ReservationStatus,
    WorkflowDraft,
)


MEDIA_ROOT = tempfile.mkdtemp(prefix="fleet-redesign-tests-")


def tearDownModule():
    shutil.rmtree(MEDIA_ROOT, ignore_errors=True)


def valid_png(name="evidence.png"):
    buffer = BytesIO()
    PillowImage.new("RGB", (40, 24), color=(30, 90, 160)).save(buffer, "PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=MEDIA_ROOT)
class UXFoundationAPITests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.admin = users.objects.create_user(username="admin", password="Strong-9284!", role="admin")
        self.ops = users.objects.create_user(username="ops", password="Strong-9284!", role="operations")
        self.other_ops = users.objects.create_user(
            username="ops2",
            password="Strong-9284!",
            role="operations",
        )
        self.superuser = users.objects.create_superuser(username="root", password="Strong-9284!")
        self.category = VehicleCategory.objects.create(
            name="Dual meter",
            meter_mode=VehicleCategory.MeterMode.BOTH,
        )
        self.supplier = Company.objects.create(
            name="Supplier",
            company_type=Company.CompanyType.SUPPLIER,
            contact_name="Supply Contact",
            phone="111",
        )
        self.borrower_company = Company.objects.create(
            name="Borrower",
            company_type=Company.CompanyType.SUBCONTRACTOR,
            contact_name="Borrower Contact",
            phone="222",
        )

    def api_client(self, user=None):
        client = APIClient()
        client.force_authenticate(user=user or self.ops)
        return client

    def vehicle(self, status_value=VehicleStatus.AVAILABLE, number=None):
        return Vehicle.objects.create(
            internal_number=number or f"FZ-R-{Vehicle.objects.count() + 1}",
            category=self.category,
            manufacturer="Acme",
            model="Lift",
            status=status_value,
            current_odometer_km=100,
            current_operating_hours="10.0",
        )

    def upload_signature(self, user=None):
        response = self.api_client(user).post(
            "/api/v1/media/",
            {"file": valid_png("signature.png"), "media_type": MediaType.SIGNATURE},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.data["id"]

    def workbook(self, header, rows):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(header)
        for row in rows:
            sheet.append(row)
        buffer = BytesIO()
        workbook.save(buffer)
        workbook.close()
        return SimpleUploadedFile(
            "vehicles.xlsx",
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def test_manual_creation_ignores_unsafe_available_status(self):
        response = self.api_client(self.admin).post(
            "/api/v1/vehicles/",
            {
                "category": str(self.category.id),
                "manufacturer": "Acme",
                "model": "New",
                "status": VehicleStatus.AVAILABLE,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], VehicleStatus.ANNOUNCED)
        self.assertTrue(response.data["capabilities"]["can_check_in"])

    def test_create_and_check_in_is_atomic_and_idempotent(self):
        payload = {
            "category": str(self.category.id),
            "manufacturer": "Acme",
            "model": "Arrival",
            "supplier_company": str(self.supplier.id),
            "condition_outcome": ConditionOutcome.FIT,
            "odometer_km": 10,
            "operating_hours": "1.0",
        }
        first = self.api_client().post(
            "/api/v1/workflows/check-ins/create-and-check-in/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="arrival-1",
        )
        replay = self.api_client().post(
            "/api/v1/workflows/check-ins/create-and-check-in/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="arrival-1",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(first.data["id"], replay.data["id"])
        self.assertEqual(Vehicle.objects.count(), 1)
        vehicle = Vehicle.objects.get()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)
        self.assertEqual(CheckInProtocol.objects.count(), 1)
        self.assertIsNotNone(CheckInProtocol.objects.get().pdf_media_id)
        self.assertTrue(first.data["capabilities"]["can_loan_checkout"])

    def test_check_in_requires_supplier_outcome_and_applicable_readings(self):
        vehicle = self.vehicle(VehicleStatus.ANNOUNCED)
        missing = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {"vehicle": str(vehicle.id)},
            format="json",
        )
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        details = missing.data["error"]["details"]
        self.assertIn("supplier_company", details)
        self.assertIn("condition_outcome", details)

        none_category = VehicleCategory.objects.create(
            name="No meter",
            meter_mode=VehicleCategory.MeterMode.NONE,
        )
        no_meter_vehicle = Vehicle.objects.create(
            category=none_category,
            manufacturer="Acme",
            model="Trailer",
        )
        inapplicable = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(no_meter_vehicle.id),
                "supplier_company": str(self.supplier.id),
                "condition_outcome": ConditionOutcome.FIT,
                "odometer_km": 1,
            },
            format="json",
        )
        self.assertEqual(inapplicable.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("odometer_km", inapplicable.data["error"]["details"])

    def test_all_meter_modes_require_exactly_their_applicable_readings(self):
        cases = [
            (VehicleCategory.MeterMode.ODOMETER, {"odometer_km": 1}),
            (VehicleCategory.MeterMode.HOURS, {"operating_hours": "1.0"}),
            (
                VehicleCategory.MeterMode.BOTH,
                {"odometer_km": 1, "operating_hours": "1.0"},
            ),
            (VehicleCategory.MeterMode.NONE, {}),
        ]
        for index, (meter_mode, readings) in enumerate(cases):
            with self.subTest(meter_mode=meter_mode):
                category = VehicleCategory.objects.create(
                    name=f"Meter mode {index}",
                    meter_mode=meter_mode,
                )
                response = self.api_client().post(
                    "/api/v1/workflows/check-ins/create-and-check-in/",
                    {
                        "category": str(category.id),
                        "manufacturer": "Meter",
                        "model": "Test",
                        "supplier_company": str(self.supplier.id),
                        "condition_outcome": ConditionOutcome.FIT,
                        **readings,
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
                created_vehicle = Vehicle.objects.get(pk=response.data["vehicle"])
                self.assertEqual(created_vehicle.category.meter_mode, meter_mode)

    def test_reservation_fulfills_atomically_and_pdf_embeds_signature(self):
        vehicle = self.vehicle()
        start = timezone.now() - timedelta(minutes=5)
        reservation_response = self.api_client().post(
            "/api/v1/reservations/",
            {
                "vehicle": str(vehicle.id),
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(days=1)).isoformat(),
                "company": str(self.borrower_company.id),
            },
            format="json",
        )
        self.assertEqual(reservation_response.status_code, status.HTTP_201_CREATED, reservation_response.data)
        reservation = Reservation.objects.get()
        self.assertEqual(reservation.snapshot["party"]["type"], "company")

        checkout = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "reservation_id": str(reservation.id),
                "expected_return_at": (start + timedelta(hours=10)).isoformat(),
                "checkout_odometer_km": 101,
                "checkout_operating_hours": "10.5",
                "media_file_ids": [self.upload_signature()],
            },
            format="json",
        )
        self.assertEqual(checkout.status_code, status.HTTP_201_CREATED, checkout.data)
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, ReservationStatus.FULFILLED)
        self.assertEqual(str(reservation.loan_id), checkout.data["id"])
        self.assertEqual(checkout.data["borrower_name"], "Borrower Contact")
        pdf = MediaFile.objects.get(pk=checkout.data["checkout_pdf_media"])
        with default_storage.open(pdf.storage_key, "rb") as stored:
            self.assertIn(b"/Subtype /Image", stored.read())

    def test_checkout_blocks_current_reservation_without_conversion(self):
        vehicle = self.vehicle()
        now = timezone.now()
        Reservation.objects.create(
            vehicle=vehicle,
            start_at=now - timedelta(minutes=1),
            end_at=now + timedelta(hours=4),
            reserved_for="Manual Party",
            manual_phone="333",
            snapshot={
                "party": {"type": "manual", "name": "Manual Party", "phone": "333"},
            },
            created_by=self.ops,
        )
        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Other",
                "borrower_phone": "444",
                "expected_return_at": (now + timedelta(hours=2)).isoformat(),
                "checkout_odometer_km": 101,
                "checkout_operating_hours": "10.2",
                "media_file_ids": [self.upload_signature()],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Loan.objects.count(), 0)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)

    def test_checkout_warns_for_later_reservation_before_expected_return(self):
        vehicle = self.vehicle()
        now = timezone.now()
        reservation = Reservation.objects.create(
            vehicle=vehicle,
            start_at=now + timedelta(hours=4),
            end_at=now + timedelta(hours=6),
            reserved_for="Later Party",
            manual_phone="333",
            snapshot={"party": {"type": "manual", "name": "Later Party", "phone": "333"}},
            created_by=self.ops,
        )
        response = self.api_client().post(
            "/api/v1/loans/",
            {
                "vehicle": str(vehicle.id),
                "borrower_name": "Current Party",
                "borrower_phone": "444",
                "expected_return_at": (now + timedelta(hours=5)).isoformat(),
                "checkout_odometer_km": 101,
                "checkout_operating_hours": "10.2",
                "media_file_ids": [self.upload_signature()],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(
            response.data["warnings"],
            [
                {
                    "code": "reservation_before_expected_return",
                    "reservation_id": str(reservation.id),
                    "start_at": reservation.start_at.isoformat(),
                }
            ],
        )

    def test_reservation_edit_cancel_and_no_show_are_audited(self):
        now = timezone.now()
        vehicle = self.vehicle()
        created = self.api_client().post(
            "/api/v1/reservations/",
            {
                "vehicle": str(vehicle.id),
                "start_at": (now + timedelta(hours=2)).isoformat(),
                "end_at": (now + timedelta(hours=3)).isoformat(),
                "reserved_for": "Manual Party",
                "manual_phone": "333",
            },
            format="json",
        )
        reservation_id = created.data["id"]
        edited = self.api_client().patch(
            f"/api/v1/reservations/{reservation_id}/",
            {"notes": "Bring identification"},
            format="json",
        )
        self.assertEqual(edited.status_code, status.HTTP_200_OK, edited.data)
        immutable_party = self.api_client().patch(
            f"/api/v1/reservations/{reservation_id}/",
            {"reserved_for": "Different Party"},
            format="json",
        )
        self.assertEqual(immutable_party.status_code, status.HTTP_400_BAD_REQUEST)
        cancelled = self.api_client().post(f"/api/v1/reservations/{reservation_id}/cancel/")
        self.assertEqual(cancelled.status_code, status.HTTP_200_OK)
        self.assertEqual(cancelled.data["status"], ReservationStatus.CANCELLED)

        no_show = Reservation.objects.create(
            vehicle=vehicle,
            start_at=now - timedelta(hours=2),
            end_at=now - timedelta(hours=1),
            reserved_for="Late Party",
            manual_phone="444",
            snapshot={"party": {"type": "manual", "name": "Late Party", "phone": "444"}},
            created_by=self.ops,
        )
        marked = self.api_client().post(f"/api/v1/reservations/{no_show.id}/mark-no-show/")
        self.assertEqual(marked.status_code, status.HTTP_200_OK)
        self.assertEqual(marked.data["status"], ReservationStatus.NO_SHOW)
        self.assertTrue(AuditLog.objects.filter(action="reservation.edited", entity_id=reservation_id).exists())
        self.assertTrue(AuditLog.objects.filter(action="reservation.cancelled", entity_id=reservation_id).exists())
        self.assertTrue(AuditLog.objects.filter(action="reservation.no_show", entity_id=no_show.id).exists())

    def test_return_requires_outcome_exposes_context_and_preserves_open_damage(self):
        vehicle = self.vehicle(VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="555",
            expected_return_at=timezone.now() + timedelta(days=1),
            checkout_odometer_km=100,
            checkout_operating_hours="10.0",
            checkout_snapshot={"immutable": True},
            created_by=self.ops,
        )
        DamageReport.objects.create(
            vehicle=vehicle,
            loan=loan,
            workflow_phase="loan_checkout",
            description="Existing",
            created_by=self.ops,
        )
        context = self.api_client().get(f"/api/v1/loans/{loan.id}/return-context/")
        self.assertEqual(context.status_code, status.HTTP_200_OK)
        self.assertEqual(context.data["checkout"]["snapshot"], {"immutable": True})
        self.assertEqual(context.data["borrower"]["phone"], "555")
        self.assertEqual(len(context.data["open_damages"]), 1)

        missing = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {"return_odometer_km": 101, "return_operating_hours": "10.5"},
            format="json",
        )
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        returned = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {
                "condition_outcome": ConditionOutcome.FIT,
                "return_odometer_km": 101,
                "return_operating_hours": "10.5",
            },
            format="json",
        )
        self.assertEqual(returned.status_code, status.HTTP_200_OK, returned.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)
        self.assertEqual(returned.data["usage_deltas"]["odometer_km"], 1)

    def test_return_maintenance_outcome_opens_maintenance_atomically(self):
        vehicle = self.vehicle(VehicleStatus.LOANED)
        loan = Loan.objects.create(
            vehicle=vehicle,
            borrower_name="Borrower",
            borrower_phone="555",
            expected_return_at=timezone.now() + timedelta(days=1),
            checkout_odometer_km=100,
            checkout_operating_hours="10.0",
            checkout_snapshot={"vehicle": {"id": str(vehicle.id)}},
            created_by=self.ops,
        )
        returned = self.api_client().post(
            f"/api/v1/loans/{loan.id}/return/",
            {
                "condition_outcome": ConditionOutcome.MAINTENANCE,
                "return_notes": "Hydraulic inspection required",
                "return_odometer_km": 101,
                "return_operating_hours": "10.5",
            },
            format="json",
        )
        self.assertEqual(returned.status_code, status.HTTP_200_OK, returned.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.MAINTENANCE)
        maintenance = MaintenanceRecord.objects.get(vehicle=vehicle)
        self.assertEqual(maintenance.status, MaintenanceStatus.ACTIVE)
        self.assertEqual(maintenance.reason, "Hydraulic inspection required")
        self.assertEqual(Loan.objects.get(pk=loan.id).status, LoanStatus.RETURNED)

    def test_maintenance_recovery_obeys_open_damage(self):
        vehicle = self.vehicle()
        started = self.api_client().post(
            f"/api/v1/vehicles/{vehicle.id}/send-to-maintenance/",
            {"reason": "Inspection", "odometer_km": 100, "operating_hours": "10.0"},
            format="json",
        )
        self.assertEqual(started.status_code, status.HTTP_201_CREATED, started.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.MAINTENANCE)
        record = MaintenanceRecord.objects.get()
        self.assertEqual(record.status, MaintenanceStatus.ACTIVE)
        tasks = self.api_client().get("/api/v1/dashboard/tasks/")
        maintenance_task = next(
            item
            for item in tasks.data["groups"]["condition_attention"]["items"]
            if item["vehicle_id"] == str(vehicle.id)
        )
        self.assertEqual(
            maintenance_task["next_action"]["url"],
            f"/api/v1/vehicles/{vehicle.id}/complete-maintenance/",
        )
        damage = DamageReport.objects.create(
            vehicle=vehicle,
            description="Open issue",
            created_by=self.ops,
        )
        completed = self.api_client().post(
            f"/api/v1/vehicles/{vehicle.id}/complete-maintenance/",
            {"notes": "Inspection done", "odometer_km": 100, "operating_hours": "10.0"},
            format="json",
        )
        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.DAMAGED)
        resolved = self.api_client().post(
            f"/api/v1/damage-reports/{damage.id}/resolve/",
            {"resolution_notes": "Fixed"},
            format="json",
        )
        self.assertEqual(resolved.status_code, status.HTTP_200_OK)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)

    def test_manufacturer_return_policy_rejects_active_maintenance(self):
        vehicle = self.vehicle(VehicleStatus.MAINTENANCE)
        response = self.api_client().post(
            "/api/v1/workflows/manufacturer-returns/",
            {
                "vehicle": str(vehicle.id),
                "recipient_company": str(self.supplier.id),
                "odometer_km": 100,
                "operating_hours": "10.0",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.MAINTENANCE)

    def test_drafts_enforce_owner_version_and_signature_media_only(self):
        created = self.api_client().post(
            "/api/v1/workflow-drafts/",
            {
                "workflow_type": "loan_return",
                "scope_key": "loan-1",
                "form_data": {"notes": "partial"},
                "step": 2,
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        draft_id = created.data["id"]
        forbidden = self.api_client(self.other_ops).get(f"/api/v1/workflow-drafts/{draft_id}/")
        self.assertEqual(forbidden.status_code, status.HTTP_404_NOT_FOUND)
        conflict = self.api_client().post(
            "/api/v1/workflow-drafts/",
            {
                "workflow_type": "loan_return",
                "scope_key": "loan-1",
                "form_data": {"notes": "stale"},
                "expected_version": 0,
            },
            format="json",
        )
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        unsafe = self.api_client().post(
            "/api/v1/workflow-drafts/",
            {
                "workflow_type": "check_in",
                "scope_key": "unsafe",
                "form_data": {"signature_bitmap": "data:image/png;base64,abc"},
            },
            format="json",
        )
        self.assertEqual(unsafe.status_code, status.HTTP_400_BAD_REQUEST)
        secret = self.api_client().post(
            "/api/v1/workflow-drafts/",
            {
                "workflow_type": "reservation",
                "scope_key": "secret",
                "form_data": {"nested": {"access_token": "do-not-store"}},
            },
            format="json",
        )
        self.assertEqual(secret.status_code, status.HTTP_400_BAD_REQUEST)
        discarded = self.api_client().post(f"/api/v1/workflow-drafts/{draft_id}/discard/")
        self.assertEqual(discarded.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(WorkflowDraft.objects.filter(pk=draft_id).exists())

    def test_expired_draft_cleanup_removes_only_unreferenced_staged_media(self):
        held_id = self.upload_signature()
        shared_id = self.upload_signature()
        expired = WorkflowDraft.objects.create(
            owner=self.ops,
            workflow_type=WorkflowDraft.WorkflowType.CHECK_IN,
            scope_key="expired",
            staged_media_ids=[held_id, shared_id],
            expires_at=timezone.now() + timedelta(hours=1),
        )
        WorkflowDraft.objects.filter(pk=expired.id).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )
        WorkflowDraft.objects.create(
            owner=self.ops,
            workflow_type=WorkflowDraft.WorkflowType.LOAN_CHECKOUT,
            scope_key="active",
            staged_media_ids=[shared_id],
            expires_at=timezone.now() + timedelta(hours=1),
        )
        call_command("cleanup_staged_media")
        self.assertFalse(WorkflowDraft.objects.filter(pk=expired.id).exists())
        self.assertFalse(MediaFile.objects.filter(pk=held_id).exists())
        self.assertTrue(MediaFile.objects.filter(pk=shared_id).exists())

    def test_document_register_tasks_readiness_and_superuser_capability(self):
        vehicle = self.vehicle(VehicleStatus.ANNOUNCED)
        protocol = CheckInProtocol.objects.create(
            vehicle=vehicle,
            performed_by=self.ops,
            supplier_company=self.supplier,
            odometer_km=100,
            operating_hours="10.0",
            snapshot={"vehicle": {"id": str(vehicle.id)}},
            pdf_generation_error="storage unavailable",
        )
        register = self.api_client().get("/api/v1/documents/register/?status=failed")
        self.assertEqual(register.status_code, status.HTTP_200_OK)
        self.assertEqual(register.data["results"][0]["record_id"], str(protocol.id))
        self.assertEqual(register.data["results"][0]["creator"], str(self.ops.id))
        self.assertEqual(register.data["results"][0]["creator_label"], self.ops.display_name)
        attention = self.api_client().get("/api/v1/documents/register/?status=attention")
        self.assertEqual(attention.data["count"], 1)
        exported = self.api_client().get("/api/v1/documents/register-export-csv/?status=failed")
        self.assertEqual(exported.status_code, status.HTTP_200_OK)
        export_text = exported.content.decode("utf-8-sig")
        self.assertIn("failure_reason", export_text)
        self.assertIn("storage unavailable", export_text)
        tasks = self.api_client().get("/api/v1/dashboard/tasks/")
        self.assertEqual(tasks.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(tasks.data["groups"]["arrivals_awaiting_check_in"]["count"], 1)
        self.assertGreaterEqual(tasks.data["groups"]["failed_documents"]["count"], 1)
        readiness = self.api_client(self.superuser).get("/api/v1/setup/readiness/")
        self.assertEqual(readiness.status_code, status.HTTP_200_OK)
        self.assertEqual(readiness.data["effective_role"], "admin")
        self.assertTrue(readiness.data["capabilities"]["is_app_admin"])
        with self.settings(BACKUP_STATUS="s3://credential-bearing-internal-value"):
            sanitized = self.api_client(self.superuser).get("/api/v1/setup/readiness/")
        backup = next(item for item in sanitized.data["checklist"] if item["id"] == "backup")
        self.assertEqual(backup["status"], "configured")
        self.assertNotIn("credential", str(sanitized.data))

        retried = self.api_client().post(
            "/api/v1/documents/retry/",
            {
                "document_type": "check_in_protocol_pdf",
                "record_id": str(protocol.id),
                "language": "de",
            },
            format="json",
        )
        self.assertEqual(retried.status_code, status.HTTP_200_OK, retried.data)
        self.assertEqual(retried.data["count"], 1)
        protocol.refresh_from_db()
        self.assertEqual(protocol.pdf_generation_error, "")
        retry_item = {
            "document_type": "check_in_protocol_pdf",
            "record_id": str(protocol.id),
            "language": "de",
        }
        denied_bulk = self.api_client().post(
            "/api/v1/documents/retry/",
            {"items": [retry_item, retry_item]},
            format="json",
        )
        self.assertEqual(denied_bulk.status_code, status.HTTP_403_FORBIDDEN)
        admin_bulk = self.api_client(self.admin).post(
            "/api/v1/documents/retry/",
            {"items": [retry_item, retry_item]},
            format="json",
        )
        self.assertEqual(admin_bulk.status_code, status.HTTP_200_OK)
        self.assertTrue(AuditLog.objects.filter(action="document.bulk_retried").exists())

    @override_settings(MAX_PDF_EVIDENCE_PIXELS=1)
    def test_pdf_pixel_limit_records_failure_without_rolling_back_workflow(self):
        vehicle = self.vehicle(VehicleStatus.ANNOUNCED)
        photo = self.api_client().post(
            "/api/v1/media/",
            {"file": valid_png("large-dimensions.png"), "media_type": MediaType.PHOTO},
            format="multipart",
        )
        completed = self.api_client().post(
            "/api/v1/workflows/check-ins/",
            {
                "vehicle": str(vehicle.id),
                "supplier_company": str(self.supplier.id),
                "condition_outcome": ConditionOutcome.FIT,
                "odometer_km": 100,
                "operating_hours": "10.0",
                "media_file_ids": [photo.data["id"]],
            },
            format="json",
        )
        self.assertEqual(completed.status_code, status.HTTP_201_CREATED, completed.data)
        protocol = CheckInProtocol.objects.get(pk=completed.data["id"])
        self.assertTrue(protocol.pdf_generation_error)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.status, VehicleStatus.AVAILABLE)
        register = self.api_client().get("/api/v1/documents/register/?status=failed")
        self.assertEqual(register.data["results"][0]["record_id"], str(protocol.id))

    def test_password_reset_archive_correction_and_audit_export(self):
        temporary = self.api_client(self.admin).post(
            f"/api/v1/users/{self.ops.id}/set-temporary-password/",
            {"new_password": "Temporary-9284!"},
            format="json",
        )
        self.assertEqual(temporary.status_code, status.HTTP_200_OK, temporary.data)
        self.ops.refresh_from_db()
        self.assertTrue(self.ops.must_change_password)
        changed = self.api_client(self.ops).post(
            f"/api/v1/users/{self.ops.id}/set-password/",
            {
                "current_password": "Temporary-9284!",
                "new_password": "Permanent-5831!",
            },
            format="json",
        )
        self.assertEqual(changed.status_code, status.HTTP_204_NO_CONTENT)
        self.ops.refresh_from_db()
        self.assertFalse(self.ops.must_change_password)

        vehicle = self.vehicle(VehicleStatus.MANUFACTURER_CHECKOUT)
        missing_reason = self.api_client(self.admin).post(f"/api/v1/vehicles/{vehicle.id}/archive/", {}, format="json")
        self.assertEqual(missing_reason.status_code, status.HTTP_400_BAD_REQUEST)
        archived = self.api_client(self.admin).post(
            f"/api/v1/vehicles/{vehicle.id}/archive/",
            {"reason": "Returned permanently"},
            format="json",
        )
        self.assertEqual(archived.status_code, status.HTTP_200_OK, archived.data)
        restored = self.api_client(self.admin).post(
            f"/api/v1/vehicles/{vehicle.id}/unarchive/",
            {"reason": "Archive selected in error"},
            format="json",
        )
        self.assertEqual(restored.status_code, status.HTTP_200_OK, restored.data)
        today = timezone.localdate().isoformat()
        export = self.api_client(self.admin).get(
            f"/api/v1/audit-logs/export-csv/?action=vehicle.&date_from={today}&date_to={today}"
        )
        self.assertEqual(export.status_code, status.HTTP_200_OK)
        self.assertIn("vehicle.archived", export.content.decode())
        self.assertTrue(AuditLog.objects.filter(action="vehicle.unarchived", entity_id=vehicle.id).exists())

    def test_import_diff_absent_vs_clear_exclusions_external_key_and_supplier_proposal(self):
        vehicle = self.vehicle(VehicleStatus.ANNOUNCED)
        vehicle.external_key = "SOURCE-1"
        vehicle.notes = "keep"
        vehicle.save()
        upload = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["external_key", "manufacturer", "model", "supplier"],
                    [
                        ["SOURCE-1", "Updated", "Lift 2", "Proposed Supplier"],
                        ["SOURCE-2", "", "Invalid", ""],
                    ],
                )
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, status.HTTP_201_CREATED)
        self.assertEqual(upload.data["status"], "failed")
        first = upload.data["result"]["rows"][0]
        self.assertNotIn("notes", first["present_fields"])
        self.assertEqual(first["supplier_proposal"]["status"], "create_proposal")
        self.assertFalse(Company.objects.filter(name="Proposed Supplier").exists())
        german_errors = self.api_client(self.admin).get(
            f"/api/v1/imports/{upload.data['id']}/errors-csv/",
            HTTP_ACCEPT_LANGUAGE="de",
        )
        english_errors = self.api_client(self.admin).get(
            f"/api/v1/imports/{upload.data['id']}/errors-csv/",
            HTTP_ACCEPT_LANGUAGE="en",
        )
        self.assertTrue(german_errors.content.decode("utf-8-sig").startswith("Zeile,Feld,Code,Meldung"))
        self.assertTrue(english_errors.content.decode("utf-8-sig").startswith("row,field,code,message"))
        excluded = self.api_client(self.admin).post(
            f"/api/v1/imports/{upload.data['id']}/exclude-rows/",
            {"row_numbers": [3]},
            format="json",
        )
        self.assertEqual(excluded.status_code, status.HTTP_200_OK, excluded.data)
        self.assertEqual(excluded.data["status"], "validated")
        committed = self.api_client(self.admin).post(
            f"/api/v1/imports/{upload.data['id']}/commit/",
            {},
            format="json",
        )
        self.assertEqual(committed.status_code, status.HTTP_200_OK, committed.data)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.manufacturer, "Updated")
        self.assertEqual(vehicle.notes, "keep")
        self.assertEqual(Vehicle.objects.count(), 1)
        generated_ids = self.api_client(self.admin).get(
            f"/api/v1/imports/{upload.data['id']}/generated-ids-csv/"
        )
        self.assertEqual(generated_ids.status_code, status.HTTP_200_OK)
        self.assertIn(str(vehicle.id), generated_ids.content.decode("utf-8-sig"))

        clear = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["external_key", "manufacturer", "model", "notes"],
                    [["SOURCE-1", "Updated", "Lift 2", ""]],
                )
            },
            format="multipart",
        )
        diff = {item["field"]: item for item in clear.data["result"]["rows"][0]["diff"]}
        self.assertTrue(diff["notes"]["explicit_clear"])
        self.api_client(self.admin).post(f"/api/v1/imports/{clear.data['id']}/commit/", {}, format="json")
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.notes, "")

        candidate = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["external_key", "manufacturer", "model"],
                    [["SOURCE-NEW", "Updated", "Lift 2"]],
                )
            },
            format="multipart",
        )
        suggestions = candidate.data["result"]["rows"][0]["duplicate_candidates"]
        self.assertEqual(suggestions[0]["vehicle_id"], str(vehicle.id))
        self.assertIn("manufacturer_model", suggestions[0]["matched_fields"])

        legacy = self.vehicle(VehicleStatus.ANNOUNCED, number="LEGACY-INTERNAL")
        external_assignment = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["external_key", "internal_number", "manufacturer", "model"],
                    [["ASSIGNED-LATER", "LEGACY-INTERNAL", "Legacy Updated", "Lift"]],
                )
            },
            format="multipart",
        )
        self.assertEqual(external_assignment.data["result"]["rows"][0]["action"], "update")
        assigned = self.api_client(self.admin).post(
            f"/api/v1/imports/{external_assignment.data['id']}/commit/",
            {},
            format="json",
        )
        self.assertEqual(assigned.status_code, status.HTTP_200_OK, assigned.data)
        legacy.refresh_from_db()
        self.assertEqual(legacy.external_key, "ASSIGNED-LATER")
        identity_conflict = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["external_key", "internal_number", "manufacturer", "model"],
                    [["SOURCE-1", "LEGACY-INTERNAL", "Conflict", "Lift"]],
                )
            },
            format="multipart",
        )
        conflict_errors = identity_conflict.data["result"]["rows"][0]["errors"]
        self.assertIn("identity_conflict", {item["code"] for item in conflict_errors})

    def test_import_commit_rejects_stale_validated_master_data(self):
        vehicle = self.vehicle(VehicleStatus.ANNOUNCED, number="STALE-IMPORT")
        upload = self.api_client(self.admin).post(
            "/api/v1/imports/vehicles/",
            {
                "file": self.workbook(
                    ["internal_number", "manufacturer", "model"],
                    [["STALE-IMPORT", "Imported", "Lift"]],
                )
            },
            format="multipart",
        )
        self.assertEqual(upload.data["status"], "validated")
        vehicle.manufacturer = "Concurrent edit"
        vehicle.save()
        commit = self.api_client(self.admin).post(
            f"/api/v1/imports/{upload.data['id']}/commit/",
            {},
            format="json",
        )
        self.assertEqual(commit.status_code, status.HTTP_400_BAD_REQUEST)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.manufacturer, "Concurrent edit")

    def test_duplicate_merges_category_reactivation_and_qr_bulk(self):
        source_company = Company.objects.create(
            name="Duplicate Co",
            company_type=Company.CompanyType.SUBCONTRACTOR,
        )
        target_company = Company.objects.create(
            name="Duplicate Co 2",
            company_type=Company.CompanyType.SUBCONTRACTOR,
        )
        source_driver = Driver.objects.create(
            first_name="Alex",
            last_name="Same",
            phone="123",
            company=source_company,
        )
        target_driver = Driver.objects.create(
            first_name="Alex",
            last_name="Same",
            phone="123",
            company=target_company,
        )
        vehicle = self.vehicle()
        loan = Loan.objects.create(
            vehicle=vehicle,
            company=source_company,
            driver=source_driver,
            borrower_name="Alex Same",
            borrower_phone="123",
            expected_return_at=timezone.now() + timedelta(days=1),
            created_by=self.ops,
        )
        preview = self.api_client(self.admin).post(
            f"/api/v1/drivers/{source_driver.id}/merge/",
            {"target_id": str(target_driver.id)},
            format="json",
        )
        self.assertTrue(preview.data["confirmation_required"])
        merged = self.api_client(self.admin).post(
            f"/api/v1/drivers/{source_driver.id}/merge/",
            {
                "target_id": str(target_driver.id),
                "confirmation_token": preview.data["confirmation_token"],
            },
            format="json",
        )
        self.assertEqual(merged.status_code, status.HTTP_200_OK, merged.data)
        loan.refresh_from_db()
        self.assertEqual(loan.driver, target_driver)
        self.assertTrue(AuditLog.objects.filter(action="driver.merged", entity_id=source_driver.id).exists())

        company_preview = self.api_client(self.admin).post(
            f"/api/v1/companies/{source_company.id}/merge/",
            {"target_id": str(target_company.id)},
            format="json",
        )
        company_merge = self.api_client(self.admin).post(
            f"/api/v1/companies/{source_company.id}/merge/",
            {
                "target_id": str(target_company.id),
                "confirmation_token": company_preview.data["confirmation_token"],
            },
            format="json",
        )
        self.assertEqual(company_merge.status_code, status.HTTP_200_OK, company_merge.data)
        loan.refresh_from_db()
        self.assertEqual(loan.company, target_company)
        self.assertTrue(
            AuditLog.objects.filter(action="company.merged", entity_id=source_company.id).exists()
        )

        self.category.is_active = False
        self.category.save()
        reactivated = self.api_client(self.admin).post(
            f"/api/v1/vehicle-categories/{self.category.id}/reactivate/"
        )
        self.assertEqual(reactivated.status_code, status.HTTP_200_OK)
        category_detail = self.api_client(self.admin).get(
            f"/api/v1/vehicle-categories/{self.category.id}/"
        )
        self.assertEqual(category_detail.data["vehicle_count"], self.category.vehicles.count())
        archived = Vehicle.objects.create(
            category=self.category,
            manufacturer="Old",
            model="Removed",
            status=VehicleStatus.MANUFACTURER_CHECKOUT,
        )
        self.api_client(self.admin).post(
            f"/api/v1/vehicles/{archived.id}/archive/",
            {"reason": "Removed"},
            format="json",
        )
        qr = self.api_client(self.admin).get("/api/v1/vehicles/qr-bulk/?search=Acme&page_size=1")
        self.assertEqual(qr.status_code, status.HTTP_200_OK)
        self.assertTrue(all(item["status"] != VehicleStatus.ARCHIVED for item in qr.data["results"]))
        self.assertTrue(qr.data["results"][0]["public_url"].endswith(f"/v/{qr.data['results'][0]['qr_code']}"))

    def test_typeahead_endpoints_are_paginated_and_server_filtered(self):
        vehicle = self.vehicle(number="SEARCH-VEHICLE")
        Driver.objects.create(
            first_name="Search",
            last_name="Driver",
            company=self.borrower_company,
            phone="555",
        )
        vehicle_results = self.api_client().get("/api/v1/vehicles/typeahead/?search=SEARCH-VEHICLE")
        company_results = self.api_client().get("/api/v1/companies/typeahead/?search=Borrower")
        driver_results = self.api_client().get("/api/v1/drivers/typeahead/?search=Search")
        for response in (vehicle_results, company_results, driver_results):
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn("count", response.data)
            self.assertIn("results", response.data)
            self.assertEqual(response.data["count"], 1)
        self.assertEqual(vehicle_results.data["results"][0]["id"], str(vehicle.id))


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock concurrency test")
@override_settings(MEDIA_ROOT=MEDIA_ROOT)
class ReservationCheckoutConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        users = get_user_model()
        self.ops = users.objects.create_user(
            username="concurrent-ops",
            password="Strong-9284!",
            role="operations",
        )
        category = VehicleCategory.objects.create(
            name="Concurrent meter",
            meter_mode=VehicleCategory.MeterMode.BOTH,
        )
        self.vehicle = Vehicle.objects.create(
            category=category,
            manufacturer="Acme",
            model="Concurrent",
            status=VehicleStatus.AVAILABLE,
            current_odometer_km=100,
            current_operating_hours="10.0",
        )
        now = timezone.now()
        self.reservation = Reservation.objects.create(
            vehicle=self.vehicle,
            start_at=now - timedelta(minutes=1),
            end_at=now + timedelta(hours=3),
            reserved_for="Concurrent Party",
            manual_phone="555",
            snapshot={
                "party": {
                    "type": "manual",
                    "name": "Concurrent Party",
                    "phone": "555",
                }
            },
            created_by=self.ops,
        )
        client = APIClient()
        client.force_authenticate(user=self.ops)
        self.signature_ids = []
        for index in range(2):
            uploaded = client.post(
                "/api/v1/media/",
                {
                    "file": valid_png(f"concurrent-signature-{index}.png"),
                    "media_type": MediaType.SIGNATURE,
                },
                format="multipart",
            )
            self.signature_ids.append(uploaded.data["id"])

    def test_only_one_concurrent_checkout_can_fulfill_a_reservation(self):
        barrier = threading.Barrier(2)
        statuses = []
        errors = []

        def checkout(signature_id):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user=self.ops)
                barrier.wait(timeout=5)
                response = client.post(
                    "/api/v1/loans/",
                    {
                        "vehicle": str(self.vehicle.id),
                        "reservation_id": str(self.reservation.id),
                        "expected_return_at": (
                            timezone.now() + timedelta(hours=1)
                        ).isoformat(),
                        "checkout_odometer_km": 101,
                        "checkout_operating_hours": "10.1",
                        "media_file_ids": [signature_id],
                    },
                    format="json",
                )
                statuses.append(response.status_code)
            except Exception as exc:  # pragma: no cover - assertion reports worker failures
                errors.append(exc)
            finally:
                close_old_connections()

        threads = [
            threading.Thread(target=checkout, args=(signature_id,))
            for signature_id in self.signature_ids
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        self.assertFalse(errors)
        self.assertEqual(sorted(statuses), [status.HTTP_201_CREATED, status.HTTP_400_BAD_REQUEST])
        self.assertEqual(Loan.objects.filter(vehicle=self.vehicle).count(), 1)
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, ReservationStatus.FULFILLED)
