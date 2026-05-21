"""Serializers for user and session authentication APIs."""

from __future__ import annotations

from django.contrib.auth import authenticate, get_user_model
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
            "last_login",
            "date_joined",
            "password",
        ]
        read_only_fields = ["id", "last_login", "date_joined"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class CurrentUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "full_name", "display_name", "role", "is_active"]


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
