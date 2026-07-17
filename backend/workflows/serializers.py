"""Serializers for operational workflow APIs."""

import json

from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from damages.models import DamageSeverity
from drivers.models import Driver
from parties.models import Company
from vehicles.models import Vehicle, VehicleCategory, VehicleStatus
from workflows.models import (
    CheckInProtocol,
    ConditionOutcome,
    Loan,
    MaintenanceRecord,
    ManufacturerCheckOutProtocol,
    Reservation,
    ReservationStatus,
    WorkflowDraft,
)


class LoanSerializer(serializers.ModelSerializer):
    reservation_id = serializers.SerializerMethodField()
    usage_deltas = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    next_actions = serializers.SerializerMethodField()

    class Meta:
        model = Loan
        fields = [
            "id",
            "vehicle",
            "company",
            "driver",
            "borrower_name",
            "borrower_phone",
            "expected_return_at",
            "actual_return_at",
            "status",
            "checkout_odometer_km",
            "checkout_operating_hours",
            "return_odometer_km",
            "return_operating_hours",
            "checkout_notes",
            "return_notes",
            "return_condition_outcome",
            "checkout_pdf_media",
            "return_pdf_media",
            "checkout_pdf_language",
            "return_pdf_language",
            "checkout_snapshot",
            "return_snapshot",
            "checkout_pdf_generation_error",
            "return_pdf_generation_error",
            "created_by",
            "returned_by",
            "created_at",
            "updated_at",
            "reservation_id",
            "usage_deltas",
            "capabilities",
            "next_actions",
        ]
        read_only_fields = [
            "id",
            "checkout_pdf_media",
            "return_pdf_media",
            "checkout_snapshot",
            "return_snapshot",
            "checkout_pdf_generation_error",
            "return_pdf_generation_error",
            "created_by",
            "returned_by",
            "created_at",
            "updated_at",
            "reservation_id",
            "usage_deltas",
            "capabilities",
            "next_actions",
        ]

    def get_reservation_id(self, obj):
        try:
            return str(obj.reservation.id)
        except Reservation.DoesNotExist:
            return None

    def get_usage_deltas(self, obj):
        return {
            "odometer_km": (
                obj.return_odometer_km - obj.checkout_odometer_km
                if obj.return_odometer_km is not None and obj.checkout_odometer_km is not None
                else None
            ),
            "operating_hours": (
                str(obj.return_operating_hours - obj.checkout_operating_hours)
                if obj.return_operating_hours is not None and obj.checkout_operating_hours is not None
                else None
            ),
        }

    def get_capabilities(self, obj):
        from accounts.permissions import is_operations

        request = self.context.get("request")
        can_operate = is_operations(getattr(request, "user", None))
        return {
            "can_return": can_operate and obj.status == "active",
            "can_generate_checkout_pdf": can_operate,
            "can_generate_return_pdf": can_operate and obj.status == "returned",
        }

    def get_next_actions(self, obj):
        if obj.status != "active":
            return []
        return [
            {
                "action": "loan_return",
                "method": "POST",
                "url": f"/api/v1/loans/{obj.id}/return/",
            }
        ]

    def validate(self, attrs):
        driver = attrs.get("driver", getattr(self.instance, "driver", None))
        borrower_name = attrs.get("borrower_name", getattr(self.instance, "borrower_name", ""))
        if driver is None and not borrower_name:
            raise serializers.ValidationError(
                {"borrower_name": _("Borrower name is required when no driver is selected.")}
            )
        checkout_odometer = attrs.get("checkout_odometer_km", getattr(self.instance, "checkout_odometer_km", None))
        return_odometer = attrs.get("return_odometer_km", getattr(self.instance, "return_odometer_km", None))
        if checkout_odometer is not None and return_odometer is not None and return_odometer < checkout_odometer:
            raise serializers.ValidationError(
                {"return_odometer_km": _("Return odometer must not be lower than checkout odometer.")}
            )
        checkout_hours = attrs.get("checkout_operating_hours", getattr(self.instance, "checkout_operating_hours", None))
        return_hours = attrs.get("return_operating_hours", getattr(self.instance, "return_operating_hours", None))
        if checkout_hours is not None and return_hours is not None and return_hours < checkout_hours:
            raise serializers.ValidationError(
                {"return_operating_hours": _("Return operating hours must not be lower than checkout operating hours.")}
            )
        return attrs


class ReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reservation
        fields = [
            "id",
            "vehicle",
            "start_at",
            "end_at",
            "driver",
            "company",
            "reserved_for",
            "manual_phone",
            "notes",
            "status",
            "snapshot",
            "fulfilled_at",
            "fulfilled_by",
            "loan",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "snapshot",
            "fulfilled_at",
            "fulfilled_by",
            "loan",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        instance = self.instance
        if instance is not None:
            immutable_party_fields = {"vehicle", "driver", "company", "reserved_for", "manual_phone"}.intersection(
                self.initial_data
            )
            changed = {
                field
                for field in immutable_party_fields
                if str(self.initial_data.get(field) or "")
                != str(
                    getattr(instance, f"{field}_id", None)
                    if field in {"vehicle", "driver", "company"}
                    else getattr(instance, field, "")
                    or ""
                )
            }
            if changed:
                raise serializers.ValidationError(
                    {field: _("Reservation party identity is immutable; create a replacement reservation.") for field in changed}
                )
        vehicle = attrs.get("vehicle", getattr(instance, "vehicle", None))
        start = attrs.get("start_at", getattr(instance, "start_at", None))
        end = attrs.get("end_at", getattr(instance, "end_at", None))
        driver = attrs.get("driver", getattr(instance, "driver", None))
        company = attrs.get("company", getattr(instance, "company", None))
        manual_name = (attrs.get("reserved_for", getattr(instance, "reserved_for", "")) or "").strip()
        manual_phone = (attrs.get("manual_phone", getattr(instance, "manual_phone", "")) or "").strip()
        party_modes = sum((bool(driver), bool(company and not driver), bool(manual_name and not driver and not company)))
        if party_modes != 1:
            field = "driver" if not any((driver, company, manual_name)) else "party"
            raise serializers.ValidationError(
                {field: _("Choose exactly one reservation party: driver, company/contact, or manual contact.")}
            )
        if driver is not None and not driver.is_active:
            raise serializers.ValidationError({"driver": _("The selected driver is inactive.")})
        if company is not None and not company.is_active:
            raise serializers.ValidationError({"company": _("The selected company is inactive.")})
        if driver is not None and driver.company_id and company is not None and driver.company_id != company.id:
            raise serializers.ValidationError({"company": _("The driver does not belong to the selected company.")})
        if driver and not attrs.get("reserved_for") and not getattr(instance, "reserved_for", ""):
            attrs["reserved_for"] = str(driver)
            attrs["manual_phone"] = driver.phone
            if company is None and driver.company_id:
                attrs["company"] = driver.company
        elif company and not driver:
            if not company.contact_name.strip():
                raise serializers.ValidationError(
                    {"company": _("A company reservation requires a stored contact name.")}
                )
            if not (manual_phone or company.phone.strip()):
                raise serializers.ValidationError(
                    {"manual_phone": _("A company reservation requires a contact phone.")}
                )
            attrs["reserved_for"] = manual_name or company.contact_name
            attrs["manual_phone"] = manual_phone or company.phone
        elif not manual_phone:
            raise serializers.ValidationError({"manual_phone": _("A manual reservation requires a phone number.")})
        if start and end and end <= start:
            raise serializers.ValidationError({"end_at": _("Reservation end must be after its start.")})
        if vehicle and start and end:
            overlapping = Reservation.objects.filter(
                vehicle=vehicle,
                status=ReservationStatus.ACTIVE,
                start_at__lt=end,
                end_at__gt=start,
            )
            if instance is not None:
                overlapping = overlapping.exclude(pk=instance.pk)
            if overlapping.exists():
                raise serializers.ValidationError(
                    {"start_at": _("This vehicle already has an active reservation that overlaps this period.")}
                )
        return attrs

    def create(self, validated_data):
        reservation = Reservation(**validated_data)
        reservation.snapshot = _reservation_snapshot(reservation)
        reservation.save()
        return reservation


class DamageReportInputSerializer(serializers.Serializer):
    description = serializers.CharField()
    severity = serializers.ChoiceField(choices=DamageSeverity.choices, required=False)
    discovered_at = serializers.DateTimeField(required=False)
    # Media is uploaded first via the media endpoint, then attached here by id so
    # every attached file has real stored bytes and a working download URL.
    media_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


class WorkflowMediaMixin(serializers.Serializer):
    media_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


class CheckInWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    performed_at = serializers.DateTimeField(required=False)
    supplier_company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all())
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    condition_notes = serializers.CharField(required=False, allow_blank=True)
    condition_outcome = serializers.ChoiceField(
        choices=[ConditionOutcome.FIT, ConditionOutcome.NEW_DAMAGE, ConditionOutcome.MAINTENANCE],
    )
    damage_reports = DamageReportInputSerializer(many=True, required=False)

    def validate_supplier_company(self, company):
        if not company.is_active:
            raise serializers.ValidationError(_("The selected company is inactive."))
        if company.company_type not in {Company.CompanyType.SUPPLIER, Company.CompanyType.MANUFACTURER}:
            raise serializers.ValidationError(_("Check-in requires an active supplier or manufacturer."))
        return company

    def validate(self, attrs):
        _validate_meter_payload(
            attrs["vehicle"],
            attrs.get("odometer_km"),
            attrs.get("operating_hours"),
            "odometer_km",
            "operating_hours",
        )
        _validate_condition_payload(attrs, outcome_field="condition_outcome")
        return attrs


class LoanCheckoutWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all(), required=False, allow_null=True)
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all(), required=False, allow_null=True)
    borrower_name = serializers.CharField(required=False, allow_blank=True)
    borrower_phone = serializers.CharField(max_length=80, required=False, allow_blank=True)
    expected_return_at = serializers.DateTimeField()
    checkout_odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    checkout_operating_hours = serializers.DecimalField(
        max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True
    )
    checkout_notes = serializers.CharField(required=False, allow_blank=True)
    damage_reports = DamageReportInputSerializer(many=True, required=False)
    reservation_id = serializers.PrimaryKeyRelatedField(
        source="reservation",
        queryset=Reservation.objects.all(),
        required=False,
        allow_null=True,
    )

    def validate(self, attrs):
        reservation = attrs.get("reservation")
        if reservation is not None:
            party = (reservation.snapshot or {}).get("party", {})
            if reservation.driver_id and attrs.get("driver") is None:
                attrs["driver"] = reservation.driver
            if reservation.company_id and attrs.get("company") is None:
                attrs["company"] = reservation.company
            attrs.setdefault("borrower_name", party.get("name") or reservation.reserved_for)
            attrs.setdefault(
                "borrower_phone",
                party.get("phone")
                or reservation.manual_phone
                or (reservation.driver.phone if reservation.driver_id else ""),
            )
        driver = attrs.get("driver")
        company = attrs.get("company")
        if driver and company is None and driver.company_id:
            company = driver.company
            attrs["company"] = company
        borrower_name = (attrs.get("borrower_name") or (str(driver) if driver else "")).strip()
        borrower_phone = (attrs.get("borrower_phone") or (driver.phone if driver else "")).strip()
        errors = {}
        if not borrower_name:
            errors["borrower_name"] = _("Borrower name is required.")
        if not borrower_phone:
            errors["borrower_phone"] = _("Borrower phone is required.")
        if driver and not driver.is_active:
            errors["driver"] = _("The selected driver is inactive.")
        if company and not company.is_active:
            errors["company"] = _("The selected company is inactive.")
        if company and company.company_type not in {Company.CompanyType.SUBCONTRACTOR, Company.CompanyType.INTERNAL}:
            errors["company"] = _("A loan requires an active subcontractor or internal company.")
        if driver and driver.company_id and company and driver.company_id != company.id:
            errors["company"] = _("The driver does not belong to the selected company.")
        from django.utils import timezone

        if attrs.get("expected_return_at") and attrs["expected_return_at"] <= timezone.now():
            errors["expected_return_at"] = _("Expected return must be after checkout.")
        if errors:
            raise serializers.ValidationError(errors)
        _validate_meter_payload(
            attrs["vehicle"],
            attrs.get("checkout_odometer_km"),
            attrs.get("checkout_operating_hours"),
            "checkout_odometer_km",
            "checkout_operating_hours",
        )
        attrs["borrower_name"] = borrower_name
        attrs["borrower_phone"] = borrower_phone
        return attrs


class LoanReturnWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    actual_return_at = serializers.DateTimeField(required=False)
    return_odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    return_operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    return_notes = serializers.CharField(required=False, allow_blank=True)
    condition_outcome = serializers.ChoiceField(choices=ConditionOutcome.choices)
    damage_reports = DamageReportInputSerializer(many=True, required=False)

    def validate(self, attrs):
        loan = self.context.get("loan")
        if loan is not None:
            _validate_meter_payload(
                loan.vehicle,
                attrs.get("return_odometer_km"),
                attrs.get("return_operating_hours"),
                "return_odometer_km",
                "return_operating_hours",
            )
        _validate_condition_payload(attrs, outcome_field="condition_outcome")
        return attrs


class ManufacturerCheckOutWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    performed_at = serializers.DateTimeField(required=False)
    recipient_company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all())
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(max_digits=10, decimal_places=1, min_value=0, required=False, allow_null=True)
    condition_notes = serializers.CharField(required=False, allow_blank=True)
    damage_reports = DamageReportInputSerializer(many=True, required=False)

    def validate_recipient_company(self, company):
        if not company.is_active:
            raise serializers.ValidationError(_("The selected company is inactive."))
        if company.company_type not in {Company.CompanyType.MANUFACTURER, Company.CompanyType.SUPPLIER}:
            raise serializers.ValidationError(_("Manufacturer check-out requires a manufacturer or supplier."))
        return company

    def validate(self, attrs):
        _validate_meter_payload(
            attrs["vehicle"],
            attrs.get("odometer_km"),
            attrs.get("operating_hours"),
            "odometer_km",
            "operating_hours",
        )
        return attrs


class CreateAndCheckInWorkflowSerializer(WorkflowMediaMixin, serializers.Serializer):
    """One request for master data plus immutable arrival evidence."""

    internal_number = serializers.CharField(max_length=80, required=False, allow_blank=True)
    category = serializers.PrimaryKeyRelatedField(queryset=VehicleCategory.objects.all())
    manufacturer = serializers.CharField(max_length=120)
    model = serializers.CharField(max_length=120)
    serial_number = serializers.CharField(max_length=120, required=False, allow_blank=True)
    license_plate = serializers.CharField(max_length=40, required=False, allow_blank=True)
    current_location = serializers.CharField(max_length=255, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    manufacturer_return_due = serializers.DateField(required=False, allow_null=True)
    external_key = serializers.CharField(max_length=160, required=False, allow_blank=True, allow_null=True)
    # Accepted only so older clients receive a safe result; the service always
    # creates ANNOUNCED and transitions exclusively through check-in.
    status = serializers.ChoiceField(choices=VehicleStatus.choices, required=False, write_only=True)
    performed_at = serializers.DateTimeField(required=False)
    supplier_company = serializers.PrimaryKeyRelatedField(queryset=Company.objects.all())
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(
        max_digits=10,
        decimal_places=1,
        min_value=0,
        required=False,
        allow_null=True,
    )
    condition_notes = serializers.CharField(required=False, allow_blank=True)
    condition_outcome = serializers.ChoiceField(choices=ConditionOutcome.choices)
    damage_reports = DamageReportInputSerializer(many=True, required=False)

    def validate(self, attrs):
        category = attrs["category"]
        if not category.is_active:
            raise serializers.ValidationError({"category": _("The selected vehicle category is inactive.")})
        company = attrs["supplier_company"]
        if not company.is_active or company.company_type not in {
            Company.CompanyType.SUPPLIER,
            Company.CompanyType.MANUFACTURER,
        }:
            raise serializers.ValidationError(
                {"supplier_company": _("Check-in requires an active supplier or manufacturer.")}
            )
        vehicle_stub = Vehicle(category=category)
        _validate_meter_payload(
            vehicle_stub,
            attrs.get("odometer_km"),
            attrs.get("operating_hours"),
            "odometer_km",
            "operating_hours",
        )
        _validate_condition_payload(attrs, outcome_field="condition_outcome")
        attrs.pop("status", None)
        return attrs


class MaintenanceStartSerializer(WorkflowMediaMixin, serializers.Serializer):
    reason = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True)
    performed_at = serializers.DateTimeField(required=False)
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(
        max_digits=10,
        decimal_places=1,
        min_value=0,
        required=False,
        allow_null=True,
    )


class MaintenanceCompleteSerializer(WorkflowMediaMixin, serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)
    performed_at = serializers.DateTimeField(required=False)
    odometer_km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    operating_hours = serializers.DecimalField(
        max_digits=10,
        decimal_places=1,
        min_value=0,
        required=False,
        allow_null=True,
    )


class MaintenanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceRecord
        fields = [
            "id",
            "vehicle",
            "reason",
            "start_notes",
            "started_at",
            "started_by",
            "start_odometer_km",
            "start_operating_hours",
            "start_snapshot",
            "completion_notes",
            "completed_at",
            "completed_by",
            "completion_odometer_km",
            "completion_operating_hours",
            "completion_snapshot",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class WorkflowDraftSerializer(serializers.ModelSerializer):
    expected_version = serializers.IntegerField(min_value=0, write_only=True, required=False)

    class Meta:
        model = WorkflowDraft
        fields = [
            "id",
            "workflow_type",
            "scope_key",
            "object_id",
            "form_data",
            "staged_media_ids",
            "step",
            "version",
            "expected_version",
            "expires_at",
            "owner",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "version", "expires_at", "owner", "created_at", "updated_at"]

    def validate_form_data(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError(_("Draft form data must be an object."))
        secret_suffixes = ("password", "secret", "token", "api_key")

        def contains_secret_key(item):
            if isinstance(item, dict):
                return any(
                    str(key).casefold().endswith(secret_suffixes)
                    or contains_secret_key(nested)
                    for key, nested in item.items()
                )
            if isinstance(item, list):
                return any(contains_secret_key(nested) for nested in item)
            return False

        if contains_secret_key(value):
            raise serializers.ValidationError(
                _("Secrets and authentication credentials cannot be stored in workflow drafts.")
            )
        encoded = json.dumps(value, ensure_ascii=False)
        if len(encoded.encode("utf-8")) > int(getattr(settings, "MAX_WORKFLOW_DRAFT_SIZE_KB", 256)) * 1024:
            raise serializers.ValidationError(_("Draft form data is too large."))
        lowered = encoded.casefold()
        forbidden = ("signature_bitmap", "signature_data", "data:image/")
        if any(marker in lowered for marker in forbidden):
            raise serializers.ValidationError(
                _("Signature image data must be uploaded as staged media, not stored in draft JSON.")
            )
        return value

    def validate_staged_media_ids(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError(_("Draft media IDs must be a list."))
        if len(value) != len(set(str(item) for item in value)):
            raise serializers.ValidationError(_("Draft media IDs must be unique."))
        return [str(item) for item in value]


def _validate_meter_payload(vehicle, odometer, operating_hours, odometer_field, hours_field):
    mode = vehicle.category.meter_mode
    requires_odometer = mode in {VehicleCategory.MeterMode.ODOMETER, VehicleCategory.MeterMode.BOTH}
    requires_hours = mode in {VehicleCategory.MeterMode.HOURS, VehicleCategory.MeterMode.BOTH}
    errors = {}
    if requires_odometer and odometer is None:
        errors[odometer_field] = _("An odometer reading is required for this vehicle category.")
    if not requires_odometer and odometer is not None:
        errors[odometer_field] = _("Odometer readings do not apply to this vehicle category.")
    if requires_hours and operating_hours is None:
        errors[hours_field] = _("An operating-hours reading is required for this vehicle category.")
    if not requires_hours and operating_hours is not None:
        errors[hours_field] = _("Operating-hours readings do not apply to this vehicle category.")
    if errors:
        raise serializers.ValidationError(errors)


def _validate_condition_payload(attrs, *, outcome_field):
    outcome = attrs.get(outcome_field)
    damages = attrs.get("damage_reports", [])
    if outcome == ConditionOutcome.NEW_DAMAGE and not damages:
        raise serializers.ValidationError(
            {"damage_reports": _("The new-damage outcome requires at least one damage report.")}
        )
    if outcome == ConditionOutcome.FIT and damages:
        raise serializers.ValidationError(
            {outcome_field: _("The fit outcome cannot include new damage reports.")}
        )
    if outcome == ConditionOutcome.MAINTENANCE:
        notes = (attrs.get("condition_notes") or attrs.get("return_notes") or "").strip()
        if not notes:
            raise serializers.ValidationError(
                {"notes": _("A maintenance outcome requires a reason in the workflow notes.")}
            )


def _reservation_snapshot(reservation: Reservation) -> dict:
    driver = reservation.driver
    company = reservation.company
    party_type = "driver" if driver else ("company" if company else "manual")
    return {
        "schema_version": 1,
        "vehicle_id": str(reservation.vehicle_id),
        "start_at": reservation.start_at.isoformat(),
        "end_at": reservation.end_at.isoformat(),
        "party": {
            "type": party_type,
            "driver_id": str(reservation.driver_id) if reservation.driver_id else None,
            "company_id": str(reservation.company_id) if reservation.company_id else None,
            "name": reservation.reserved_for or (str(driver) if driver else (company.contact_name if company else "")),
            "phone": reservation.manual_phone or (driver.phone if driver else (company.phone if company else "")),
            "company_name": company.name if company else None,
        },
        "notes": reservation.notes,
    }


class CheckInProtocolSerializer(serializers.ModelSerializer):
    class Meta:
        model = CheckInProtocol
        fields = [
            "id",
            "vehicle",
            "performed_by",
            "performed_at",
            "supplier_company",
            "odometer_km",
            "operating_hours",
            "condition_notes",
            "snapshot",
            "pdf_media",
            "pdf_language",
            "pdf_generation_error",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "performed_by",
            "snapshot",
            "pdf_media",
            "pdf_language",
            "pdf_generation_error",
            "created_at",
            "updated_at",
        ]


class ManufacturerCheckOutProtocolSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManufacturerCheckOutProtocol
        fields = [
            "id",
            "vehicle",
            "performed_by",
            "performed_at",
            "recipient_company",
            "odometer_km",
            "operating_hours",
            "condition_notes",
            "snapshot",
            "pdf_media",
            "pdf_language",
            "pdf_generation_error",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "performed_by",
            "snapshot",
            "pdf_media",
            "pdf_language",
            "pdf_generation_error",
            "created_at",
            "updated_at",
        ]
