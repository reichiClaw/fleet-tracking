"""Company API viewsets."""

from collections import defaultdict

from django.db import transaction
from django.db.models import Count, Q
from django.utils.translation import gettext as _
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import AuthenticatedReadAdminOperationsWriteNoDelete, IsAdminRole
from audit.mixins import AuditedModelViewSetMixin
from audit.services import audit_event
from config.request import request_metadata
from config.confirmation import make_confirmation_token, verify_confirmation_token
from parties.models import Company
from parties.serializers import CompanySerializer


class CompanyViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = Company.objects.annotate(driver_count=Count("drivers")).order_by("name")
    serializer_class = CompanySerializer
    permission_classes = [AuthenticatedReadAdminOperationsWriteNoDelete]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        active = params.get("active")
        if active is not None:
            if active.lower() in {"1", "true", "yes"}:
                queryset = queryset.filter(is_active=True)
            elif active.lower() in {"0", "false", "no"}:
                queryset = queryset.filter(is_active=False)
        if params.get("company_type"):
            queryset = queryset.filter(company_type=params["company_type"])
        if params.get("search"):
            search = params["search"].strip()
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(contact_name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
            )
        return queryset

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        company = self.get_object()
        before = self._audit_snapshot(company)
        company.is_active = False
        company.save(update_fields=["is_active", "updated_at"])
        audit_event(
            actor=request.user,
            action="company.deactivated",
            entity_type="company",
            entity_id=company.id,
            before=before,
            after=self._audit_snapshot(company),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(company).data)

    @action(detail=False, methods=["get"])
    def typeahead(self, request):
        queryset = self.filter_queryset(self.get_queryset().filter(is_active=True))
        page = self.paginate_queryset(queryset)
        data = self.get_serializer(page if page is not None else queryset, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @action(detail=False, methods=["get"], permission_classes=[IsAdminRole])
    def duplicates(self, request):
        groups = defaultdict(list)
        for company in self.get_queryset().filter(is_active=True):
            key = (
                "".join(company.name.casefold().split()),
                company.company_type,
                "".join(ch for ch in company.phone if ch.isdigit()),
            )
            groups[key].append(company)
        suggestions = [
            {
                "score": 1.0,
                "reason": "normalized_name_type_phone",
                "companies": CompanySerializer(items, many=True, context={"request": request}).data,
            }
            for items in groups.values()
            if len(items) > 1
        ]
        return Response(suggestions[:100])

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def merge(self, request, pk=None):
        from drivers.models import Driver
        from workflows.models import CheckInProtocol, Loan, ManufacturerCheckOutProtocol, Reservation

        source = self.get_object()
        target_id = request.data.get("target_id")
        if not target_id or str(target_id) == str(source.id):
            raise serializers.ValidationError({"target_id": _("Choose a different target company.")})
        target = Company.objects.filter(pk=target_id, is_active=True).first()
        if target is None:
            raise serializers.ValidationError({"target_id": _("The target company is unavailable.")})
        if target.company_type != source.company_type:
            raise serializers.ValidationError({"target_id": _("Companies must have the same type to merge.")})
        counts = {
            "drivers": Driver.objects.filter(company=source).count(),
            "loans": Loan.objects.filter(company=source).count(),
            "reservations": Reservation.objects.filter(company=source).count(),
            "check_ins": CheckInProtocol.objects.filter(supplier_company=source).count(),
            "manufacturer_returns": ManufacturerCheckOutProtocol.objects.filter(
                recipient_company=source
            ).count(),
        }
        token = request.data.get("confirmation_token")
        if not token:
            return Response(
                {
                    "confirmation_required": True,
                    "confirmation_token": make_confirmation_token(
                        action="company.merge",
                        source_id=source.id,
                        target_id=target.id,
                    ),
                    "reassignment_counts": counts,
                }
            )
        verify_confirmation_token(
            token=token,
            action="company.merge",
            source_id=source.id,
            target_id=target.id,
        )
        with transaction.atomic():
            locked = {
                item.id: item
                for item in Company.objects.select_for_update().filter(pk__in=[source.id, target.id])
            }
            source = locked[source.id]
            target = locked[target.id]
            if not source.is_active or not target.is_active:
                raise serializers.ValidationError({"detail": _("Both companies must still be active.")})
            Driver.objects.filter(company=source).update(company=target)
            Loan.objects.filter(company=source).update(company=target)
            Reservation.objects.filter(company=source).update(company=target)
            CheckInProtocol.objects.filter(supplier_company=source).update(supplier_company=target)
            ManufacturerCheckOutProtocol.objects.filter(recipient_company=source).update(
                recipient_company=target
            )
            source.is_active = False
            source.save(update_fields=["is_active", "updated_at"])
            audit_event(
                actor=request.user,
                action="company.merged",
                entity_type="company",
                entity_id=source.id,
                before={"source_id": str(source.id), "target_id": str(target.id), "counts": counts},
                after={"source_active": False, "target_id": str(target.id)},
                request_meta=request_metadata(request),
            )
        return Response(
            {
                "source": self.get_serializer(source).data,
                "target": self.get_serializer(target).data,
                "reassignment_counts": counts,
            }
        )
