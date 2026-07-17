"""Stable capability flags and next-action links for API consumers."""

from __future__ import annotations

from accounts.permissions import is_admin, is_operations
from vehicles.models import VehicleStatus


def vehicle_capabilities(vehicle, user) -> dict[str, bool]:
    operations = is_operations(user)
    admin = is_admin(user)
    status = vehicle.status
    return {
        "can_edit_master_data": admin and status != VehicleStatus.ARCHIVED,
        "can_check_in": operations and status == VehicleStatus.ANNOUNCED,
        "can_loan_checkout": operations and status == VehicleStatus.AVAILABLE,
        "can_loan_return": operations and status == VehicleStatus.LOANED,
        "can_manufacturer_return": operations
        and status in {VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED},
        "can_reserve": operations
        and status not in {VehicleStatus.ARCHIVED, VehicleStatus.MANUFACTURER_CHECKOUT},
        "can_send_to_maintenance": operations
        and status in {VehicleStatus.AVAILABLE, VehicleStatus.DAMAGED},
        "can_complete_maintenance": operations and status == VehicleStatus.MAINTENANCE,
        "can_archive": admin and status == VehicleStatus.MANUFACTURER_CHECKOUT,
        "can_unarchive": admin and status == VehicleStatus.ARCHIVED,
        "can_admin_correct": admin,
    }


def vehicle_next_actions(vehicle, user) -> list[dict[str, str]]:
    capabilities = vehicle_capabilities(vehicle, user)
    vehicle_id = str(vehicle.id)
    candidates = [
        ("can_check_in", "check_in", f"/api/v1/workflows/check-ins/", "POST"),
        ("can_loan_checkout", "loan_checkout", "/api/v1/loans/", "POST"),
        ("can_loan_return", "loan_return", f"/api/v1/vehicles/{vehicle_id}/active-loan/", "GET"),
        (
            "can_manufacturer_return",
            "manufacturer_return",
            "/api/v1/workflows/manufacturer-returns/",
            "POST",
        ),
        ("can_reserve", "reservation_create", "/api/v1/reservations/", "POST"),
        (
            "can_send_to_maintenance",
            "maintenance_start",
            f"/api/v1/vehicles/{vehicle_id}/send-to-maintenance/",
            "POST",
        ),
        (
            "can_complete_maintenance",
            "maintenance_complete",
            f"/api/v1/vehicles/{vehicle_id}/complete-maintenance/",
            "POST",
        ),
    ]
    return [
        {"action": action, "url": url, "method": method}
        for capability, action, url, method in candidates
        if capabilities[capability]
    ]
