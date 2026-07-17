"""Serializers for user and session authentication APIs."""

from __future__ import annotations

from django.contrib.auth import authenticate, get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "full_name",
            "role",
            "is_active",
            "is_staff",
            "is_superuser",
            "must_change_password",
            "last_login",
            "date_joined",
            "password",
        ]
        read_only_fields = ["id", "is_staff", "is_superuser", "must_change_password", "last_login", "date_joined"]

    def validate(self, attrs):
        forbidden = {"is_staff", "is_superuser"}.intersection(self.initial_data)
        if forbidden:
            raise serializers.ValidationError(
                {field: _("This privilege flag cannot be changed through the application API.") for field in forbidden}
            )
        if self.instance is not None and "password" in attrs:
            raise serializers.ValidationError(
                {"password": _("Use the password update endpoint to change a password.")}
            )
        return attrs

    def validate_password(self, value):
        candidate = User(
            username=self.initial_data.get("username", ""),
            email=self.initial_data.get("email", ""),
            full_name=self.initial_data.get("full_name", ""),
        )
        try:
            password_validation.validate_password(value, user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages), code="invalid_password") from exc
        return value

    def validate_is_active(self, value):
        if self.instance and self.instance.is_active and not value:
            raise serializers.ValidationError(_("Use the dedicated deactivate action."))
        return value

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
            user.must_change_password = True
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class CurrentUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    effective_role = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "full_name",
            "display_name",
            "role",
            "effective_role",
            "capabilities",
            "must_change_password",
            "is_active",
        ]

    def get_effective_role(self, obj):
        return User.Role.ADMIN if obj.is_admin_role else obj.role

    def get_capabilities(self, obj):
        return {
            "is_app_admin": obj.is_admin_role,
            "can_operate_workflows": obj.is_operations_role,
            "can_manage_users": obj.is_admin_role,
            "can_view_audit_log": obj.is_admin_role,
        }


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    default_error_messages = {
        "invalid_credentials": _("Unable to log in with the provided credentials."),
        "inactive": _("This user account is inactive."),
    }

    def validate(self, attrs):
        request = self.context.get("request")
        user = authenticate(request=request, username=attrs.get("username"), password=attrs.get("password"))
        if user is None:
            raise serializers.ValidationError(self.error_messages["invalid_credentials"], code="invalid_credentials")
        if not user.is_active:
            raise serializers.ValidationError(self.error_messages["inactive"], code="inactive")
        attrs["user"] = user
        return attrs


class PasswordUpdateSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        target = self.context["target"]
        actor = self.context["request"].user
        if actor.pk == target.pk and not target.check_password(attrs.get("current_password", "")):
            raise serializers.ValidationError(
                {"current_password": _("The current password is incorrect.")},
                code="invalid_current_password",
            )
        try:
            password_validation.validate_password(attrs["new_password"], user=target)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(
                {"new_password": list(exc.messages)},
                code="invalid_password",
            ) from exc
        return attrs
