"""Reset imported-but-not-checked-in vehicles back to the "announced" state.

Earlier, imported vehicles were created as ``available``. The intended flow is
that imported vehicles start as ``announced`` and only become available after a
check-in protocol is recorded. This command repairs existing data created under
the old behaviour.

By default it only touches vehicles that were created via the Excel import
(identified by their ``import.vehicle.created`` audit log), are currently
``available``, and have no check-in protocol, loans, or active reservations —
so manually added pool vehicles and anything already in use are left alone.

Usage:
    python manage.py reset_imported_vehicles_to_announced [--dry-run] [--all]
    docker compose exec backend python manage.py reset_imported_vehicles_to_announced
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from audit.models import AuditLog
from vehicles.models import Vehicle, VehicleStatus
from workflows.models import CheckInProtocol, Loan, Reservation, ReservationStatus


class Command(BaseCommand):
    help = "Reset imported, not-yet-checked-in vehicles from 'available' back to 'announced'."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without writing to the database.",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help=(
                "Also reset available vehicles that have no check-in protocol but were not "
                "created via import (e.g. directly added). Use with care."
            ),
        )

    def handle(self, *args, **options):
        dry_run: bool = options["dry_run"]
        include_all: bool = options["all"]

        checked_in_ids = set(CheckInProtocol.objects.values_list("vehicle_id", flat=True))
        loaned_ids = set(Loan.objects.values_list("vehicle_id", flat=True))
        reserved_ids = set(
            Reservation.objects.filter(status=ReservationStatus.ACTIVE).values_list("vehicle_id", flat=True)
        )
        excluded_ids = checked_in_ids | loaned_ids | reserved_ids

        candidates = Vehicle.objects.filter(status=VehicleStatus.AVAILABLE).exclude(id__in=excluded_ids)

        if not include_all:
            imported_ids = set(
                AuditLog.objects.filter(action="import.vehicle.created").values_list("entity_id", flat=True)
            )
            candidates = candidates.filter(id__in=imported_ids)

        candidates = candidates.order_by("internal_number")
        affected = list(candidates.values_list("internal_number", flat=True))
        count = len(affected)

        if count == 0:
            self.stdout.write(self.style.SUCCESS("No vehicles needed to be reset."))
            return

        preview = ", ".join(affected[:20]) + ("…" if count > 20 else "")
        self.stdout.write(f"{count} vehicle(s) will be reset to 'announced': {preview}")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no changes were written."))
            return

        with transaction.atomic():
            # Use a bulk update so the corrective change bypasses the normal
            # status-transition guard (available -> announced is not a normal
            # workflow transition).
            updated = Vehicle.objects.filter(pk__in=list(candidates.values_list("pk", flat=True))).update(
                status=VehicleStatus.ANNOUNCED,
                updated_at=timezone.now(),
            )

        self.stdout.write(self.style.SUCCESS(f"Reset {updated} vehicle(s) to 'announced'."))
