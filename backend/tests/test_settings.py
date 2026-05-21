from django.apps import apps
from django.conf import settings
from django.test import SimpleTestCase
from django.utils.translation import gettext, override


class SettingsLoadingTests(SimpleTestCase):
    def test_database_configuration_is_loaded(self):
        database = settings.DATABASES["default"]

        self.assertIn("ENGINE", database)
        self.assertIn("NAME", database)

    def test_expected_backend_apps_are_installed(self):
        for app_label in [
            "accounts",
            "vehicles",
            "parties",
            "drivers",
            "workflows",
            "damages",
            "mediafiles",
            "imports",
            "audit",
        ]:
            with self.subTest(app_label=app_label):
                self.assertTrue(apps.is_installed(app_label))

    def test_localization_settings_support_german_and_english(self):
        language_codes = [code for code, _name in settings.LANGUAGES]

        self.assertEqual(settings.LANGUAGE_CODE, "de")
        self.assertIn("de", language_codes)
        self.assertIn("en", language_codes)

    def test_backend_catalogs_translate_representative_user_messages(self):
        with override("de"):
            self.assertEqual(gettext("Available"), "Verfügbar")
            self.assertEqual(gettext("Damage description is required."), "Eine Schadensbeschreibung ist erforderlich.")

        with override("en"):
            self.assertEqual(gettext("Available"), "Available")
            self.assertEqual(gettext("Damage description is required."), "Damage description is required.")
