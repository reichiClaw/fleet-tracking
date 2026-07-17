"""Tests for env-driven media storage backend selection."""

from __future__ import annotations

import tempfile
from unittest.mock import patch

import paramiko
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.storage import (
    FILESYSTEM_BACKEND,
    S3_BACKEND,
    SFTP_BACKEND,
    StrictSFTPStorage,
    WHITENOISE_STATIC_BACKEND,
    build_storages,
)


class StorageBuilderTests(SimpleTestCase):
    def test_defaults_to_local_filesystem(self):
        storages = build_storages({})

        self.assertEqual(storages["default"]["BACKEND"], FILESYSTEM_BACKEND)
        self.assertEqual(storages["staticfiles"]["BACKEND"], WHITENOISE_STATIC_BACKEND)

    def test_explicit_local_backend(self):
        storages = build_storages({"MEDIA_STORAGE_BACKEND": "LOCAL"})

        self.assertEqual(storages["default"]["BACKEND"], FILESYSTEM_BACKEND)

    def test_s3_backend_maps_options(self):
        storages = build_storages(
            {
                "MEDIA_STORAGE_BACKEND": "s3",
                "AWS_STORAGE_BUCKET_NAME": "fleet-media",
                "AWS_S3_ENDPOINT_URL": "https://minio.local",
                "AWS_ACCESS_KEY_ID": "key",
                "AWS_SECRET_ACCESS_KEY": "secret",
            }
        )
        options = storages["default"]["OPTIONS"]

        self.assertEqual(storages["default"]["BACKEND"], S3_BACKEND)
        self.assertEqual(options["bucket_name"], "fleet-media")
        self.assertEqual(options["endpoint_url"], "https://minio.local")
        self.assertEqual(options["default_acl"], "private")
        self.assertFalse(options["file_overwrite"])
        self.assertTrue(options["querystring_auth"])

    def test_s3_backend_requires_bucket(self):
        with self.assertRaises(ImproperlyConfigured):
            build_storages({"MEDIA_STORAGE_BACKEND": "s3"})

    def test_s3_querystring_auth_can_be_disabled(self):
        storages = build_storages(
            {
                "MEDIA_STORAGE_BACKEND": "s3",
                "AWS_STORAGE_BUCKET_NAME": "fleet-media",
                "AWS_QUERYSTRING_AUTH": "false",
            }
        )

        self.assertFalse(storages["default"]["OPTIONS"]["querystring_auth"])

    def test_sftp_backend_maps_options(self):
        storages = build_storages(
            {
                "MEDIA_STORAGE_BACKEND": "sftp",
                "SFTP_HOST": "nas.local",
                "SFTP_USER": "fleet",
                "SFTP_PORT": "2222",
                "SFTP_KEY_PATH": "/keys/id_ed25519",
                "SFTP_ROOT": "/srv/fleet-media/",
                "SFTP_KNOWN_HOSTS": "/keys/known_hosts",
            }
        )
        options = storages["default"]["OPTIONS"]

        self.assertEqual(storages["default"]["BACKEND"], SFTP_BACKEND)
        self.assertEqual(options["host"], "nas.local")
        self.assertEqual(options["root_path"], "/srv/fleet-media/")
        self.assertEqual(options["params"]["username"], "fleet")
        self.assertEqual(options["params"]["port"], 2222)
        self.assertEqual(options["params"]["key_filename"], "/keys/id_ed25519")
        self.assertEqual(options["known_host_file"], "/keys/known_hosts")
        self.assertNotIn("password", options["params"])

    def test_sftp_backend_uses_password_when_provided(self):
        storages = build_storages(
            {
                "MEDIA_STORAGE_BACKEND": "sftp",
                "SFTP_HOST": "nas.local",
                "SFTP_USER": "fleet",
                "SFTP_PASSWORD": "secret",
                "SFTP_KNOWN_HOSTS": "/keys/known_hosts",
            }
        )
        params = storages["default"]["OPTIONS"]["params"]

        self.assertEqual(params["password"], "secret")
        self.assertNotIn("key_filename", params)

    def test_sftp_backend_requires_host_and_user(self):
        with self.assertRaises(ImproperlyConfigured):
            build_storages({"MEDIA_STORAGE_BACKEND": "sftp", "SFTP_USER": "fleet"})
        with self.assertRaises(ImproperlyConfigured):
            build_storages({"MEDIA_STORAGE_BACKEND": "sftp", "SFTP_HOST": "nas.local"})
        with self.assertRaises(ImproperlyConfigured):
            build_storages(
                {
                    "MEDIA_STORAGE_BACKEND": "sftp",
                    "SFTP_HOST": "nas.local",
                    "SFTP_USER": "fleet",
                }
            )

    def test_sftp_backend_rejects_unknown_host_keys(self):
        with tempfile.NamedTemporaryFile() as known_hosts:
            storage = StrictSFTPStorage(
                host="nas.local",
                params={"username": "fleet"},
                known_host_file=known_hosts.name,
            )
            with patch("config.storage.paramiko.SSHClient") as ssh_client_class:
                ssh_client = ssh_client_class.return_value
                ssh_client.get_transport.return_value = None

                storage._connect()

        policy = ssh_client.set_missing_host_key_policy.call_args.args[0]
        self.assertIsInstance(policy, paramiko.RejectPolicy)
        ssh_client.load_host_keys.assert_called_once_with(known_hosts.name)

    def test_unknown_backend_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            build_storages({"MEDIA_STORAGE_BACKEND": "dropbox"})
