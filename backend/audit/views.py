"""Audit log API viewsets."""

import csv
import json
from datetime import datetime, time

from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import viewsets
from rest_framework.decorators import action

from accounts.permissions import AdminReadOnly
from audit.models import AuditLog
from audit.serializers import AuditLogSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [AdminReadOnly]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        if params.get("action"):
            queryset = queryset.filter(action__icontains=params["action"])
        if params.get("entity_type"):
            queryset = queryset.filter(entity_type=params["entity_type"])
        if params.get("entity_id"):
            queryset = queryset.filter(entity_id=params["entity_id"])
        if params.get("actor"):
            queryset = queryset.filter(actor_id=params["actor"])
        if params.get("date_from"):
            value = _date_boundary(params["date_from"], end=False)
            if value:
                queryset = queryset.filter(created_at__gte=value)
        if params.get("date_to"):
            value = _date_boundary(params["date_to"], end=True)
            if value:
                queryset = queryset.filter(created_at__lte=value)
        return queryset

    @action(detail=False, methods=["get"], url_path="export-csv")
    def export_csv(self, request):
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="audit-log.csv"'
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow(
            [
                "created_at",
                "actor_id",
                "action",
                "entity_type",
                "entity_id",
                "before",
                "after",
                "ip_address",
                "user_agent",
            ]
        )
        for item in self.filter_queryset(self.get_queryset()).iterator(chunk_size=1000):
            writer.writerow(
                [
                    item.created_at.isoformat(),
                    item.actor_id or "",
                    item.action,
                    item.entity_type,
                    item.entity_id or "",
                    json.dumps(item.before, ensure_ascii=False, sort_keys=True),
                    json.dumps(item.after, ensure_ascii=False, sort_keys=True),
                    item.ip_address or "",
                    item.user_agent,
                ]
            )
        return response


def _date_boundary(raw: str, *, end: bool):
    date_value = parse_date(raw)
    if date_value is not None and len(raw.strip()) == 10:
        value = datetime.combine(date_value, time.max if end else time.min)
        return timezone.make_aware(value)
    value = parse_datetime(raw)
    if value is not None:
        if timezone.is_naive(value):
            value = timezone.make_aware(value)
        return value
    if date_value is None:
        return None
    value = datetime.combine(date_value, time.max if end else time.min)
    return timezone.make_aware(value)
