"""Populate the database with realistic demo data for manual testing.

The command is idempotent for master data (categories, companies, drivers,
demo users) and only creates demo vehicles and workflow records when no demo
vehicles exist yet. It drives the real workflow services so the seeded data
respects every status invariant and produces audit logs, protocols, and loans.

Usage:
    python manage.py seed_demo_data
    docker compose exec backend python manage.py seed_demo_data
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from PIL import Image as PillowImage

from drivers.models import Driver
from mediafiles.models import MediaType
from mediafiles.services import create_media_file_from_bytes
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import ConditionOutcome
from workflows.services import (
    complete_check_in,
    complete_loan_checkout,
    complete_loan_return,
    complete_manufacturer_checkout,
)

DEMO_PREFIX = "DEMO-"

DEMO_USERS = [
    ("demo-operations", "operations", "Demo Operations"),
    ("demo-readonly", "readonly", "Demo Read-only"),
]

CATEGORIES = {
    "Steiger": VehicleCategory.MeterMode.BOTH,
    "Golf Car": VehicleCategory.MeterMode.ODOMETER,
    "Loader": VehicleCategory.MeterMode.BOTH,
    "Telehandler": VehicleCategory.MeterMode.BOTH,
    "Lifting platform": VehicleCategory.MeterMode.HOURS,
}

COMPANIES = [
    ("Muster Bau GmbH", Company.CompanyType.SUBCONTRACTOR, "Anna Bauer"),
    ("Nordwest Logistik", Company.CompanyType.SUBCONTRACTOR, "Bjorn Holm"),
    ("Hubsteiger Werke AG", Company.CompanyType.MANUFACTURER, "Werkstatt"),
    ("Teilewelt Supply", Company.CompanyType.SUPPLIER, "Lager"),
    ("Eigenbetrieb Fuhrpark", Company.CompanyType.INTERNAL, "Disposition"),
]

DRIVERS = [
    ("Lukas", "Meyer", "Muster Bau GmbH", "C, CE"),
    ("Sofia", "Klein", "Nordwest Logistik", "B"),
    ("Jonas", "Wagner", None, "B, C"),
]


class Command(BaseCommand):
    help = "Seed demonstration data (categories, companies, drivers, vehicles, workflows)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="demo-pass-1234",
            help="Password assigned to the created demo users (default: demo-pass-1234).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        password = options["password"]
        user_model = get_user_model()

        categories = {
            name: VehicleCategory.objects.get_or_create(name=name, defaults={"meter_mode": meter_mode})[0]
            for name, meter_mode in CATEGORIES.items()
        }
        companies = {
            name: Company.objects.get_or_create(
                name=name, company_type=company_type, defaults={"contact_name": contact, "is_active": True}
            )[0]
            for name, company_type, contact in COMPANIES
        }
        for first, last, company_name, license_classes in DRIVERS:
            Driver.objects.get_or_create(
                first_name=first,
                last_name=last,
                defaults={
                    "company": companies.get(company_name) if company_name else None,
                    "license_classes": license_classes,
                    "is_active": True,
                },
            )

        actor = None
        for username, role, full_name in DEMO_USERS:
            user, created = user_model.objects.get_or_create(
                username=username,
                defaults={"role": role, "full_name": full_name, "is_active": True},
            )
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
                self.stdout.write(f"Created demo user '{username}' (role={role}).")
            if role == "operations":
                actor = user
        if actor is None:
            actor = user_model.objects.filter(role="operations").first() or user_model.objects.first()

        if Vehicle.objects.filter(internal_number__startswith=DEMO_PREFIX).exists():
            self.stdout.write(self.style.WARNING("Demo vehicles already exist; skipping vehicle/workflow seeding."))
            self.stdout.write(self.style.SUCCESS("Demo master data is up to date."))
            return

        subcontractor = companies["Muster Bau GmbH"]
        manufacturer = companies["Hubsteiger Werke AG"]
        driver = Driver.objects.filter(first_name="Lukas", last_name="Meyer").first()

        def make_vehicle(number: str, category: str, manufacturer_name: str, model: str, **extra) -> Vehicle:
            return Vehicle.objects.create(
                internal_number=f"{DEMO_PREFIX}{number}",
                category=categories[category],
                manufacturer=manufacturer_name,
                model=model,
                status=VehicleStatus.ANNOUNCED,
                **extra,
            )

        now = timezone.now()

        def staged_signature(label: str):
            buffer = BytesIO()
            PillowImage.new("RGB", (320, 100), color=(245, 248, 252)).save(buffer, "PNG")
            return create_media_file_from_bytes(
                content=buffer.getvalue(),
                actor=actor,
                media_type=MediaType.SIGNATURE,
                filename=f"{label}-signature.png",
                content_type="image/png",
            )

        # Available after check-in.
        available = make_vehicle("0001", "Steiger", "Ruthmann", "T300")
        complete_check_in(
            data={
                "vehicle": available,
                "odometer_km": 1200,
                "operating_hours": Decimal("320.0"),
                "supplier_company": manufacturer,
                "condition_outcome": ConditionOutcome.FIT,
            },
            actor=actor,
        )
        available.refresh_from_db()
        available.manufacturer_return_due = now.date()
        available.save(update_fields=["manufacturer_return_due", "updated_at"])

        # Currently loaned (active loan).
        loaned = make_vehicle("0002", "Telehandler", "Manitou", "MT1840")
        complete_check_in(
            data={
                "vehicle": loaned,
                "odometer_km": 800,
                "operating_hours": Decimal("150.0"),
                "supplier_company": manufacturer,
                "condition_outcome": ConditionOutcome.FIT,
            },
            actor=actor,
        )
        active_loan = complete_loan_checkout(
            data={
                "vehicle": loaned,
                "company": subcontractor,
                "driver": driver,
                "borrower_name": "Lukas Meyer",
                "borrower_phone": "+49 170 1234567",
                "expected_return_at": now + timedelta(days=4),
                "checkout_odometer_km": 800,
                "checkout_operating_hours": Decimal("150.0"),
                "checkout_notes": "Demo loan in progress.",
                "media_file_ids": [staged_signature("active-loan").id],
            },
            actor=actor,
        )
        active_loan.expected_return_at = now - timedelta(days=1)
        active_loan.save(update_fields=["expected_return_at", "updated_at"])

        # Returned loan -> back to available with higher usage.
        returned = make_vehicle("0003", "Loader", "Caterpillar", "906M")
        complete_check_in(
            data={
                "vehicle": returned,
                "odometer_km": 2500,
                "operating_hours": Decimal("540.0"),
                "supplier_company": manufacturer,
                "condition_outcome": ConditionOutcome.FIT,
            },
            actor=actor,
        )
        loan = complete_loan_checkout(
            data={
                "vehicle": returned,
                "company": subcontractor,
                "borrower_name": "Sofia Klein",
                "borrower_phone": "+49 171 7654321",
                "expected_return_at": now + timedelta(days=1),
                "checkout_odometer_km": 2500,
                "checkout_operating_hours": Decimal("540.0"),
                "media_file_ids": [staged_signature("returned-loan").id],
            },
            actor=actor,
        )
        complete_loan_return(
            loan=loan,
            data={
                "return_odometer_km": 2750,
                "return_operating_hours": Decimal("572.5"),
                "return_notes": "Returned in good condition.",
                "condition_outcome": ConditionOutcome.FIT,
            },
            actor=actor,
        )

        # Damaged after check-in.
        damaged = make_vehicle("0004", "Golf Car", "Club Car", "Carryall 700")
        complete_check_in(
            data={
                "vehicle": damaged,
                "odometer_km": 400,
                "supplier_company": manufacturer,
                "condition_outcome": ConditionOutcome.NEW_DAMAGE,
                "condition_notes": "Visible damage on arrival.",
                "damage_reports": [{"description": "Cracked windshield", "severity": "major"}],
            },
            actor=actor,
        )

        # Returned to manufacturer.
        checkout = make_vehicle("0005", "Lifting platform", "Genie", "GS-1932")
        complete_check_in(
            data={
                "vehicle": checkout,
                "operating_hours": Decimal("90.0"),
                "supplier_company": manufacturer,
                "condition_outcome": ConditionOutcome.FIT,
            },
            actor=actor,
        )
        complete_manufacturer_checkout(
            data={
                "vehicle": checkout,
                "recipient_company": manufacturer,
                "operating_hours": Decimal("90.0"),
                "condition_notes": "End of rental period; returned to manufacturer.",
            },
            actor=actor,
        )

        # Still announced (not yet checked in).
        make_vehicle("0006", "Steiger", "Palfinger", "P200")

        self.stdout.write(self.style.SUCCESS("Seeded demo vehicles and workflow records."))
        self.stdout.write(
            "Statuses: 1 available, 1 loaned, 1 returned->available, 1 damaged, "
            "1 manufacturer_checkout, 1 announced."
        )
        self.stdout.write(
            self.style.WARNING(
                f"Demo users '{', '.join(u for u, _r, _n in DEMO_USERS)}' use password '{password}'. "
                "Do not seed demo data in production."
            )
        )
