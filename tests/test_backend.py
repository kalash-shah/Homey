import unittest
import os
import json
import sqlite3
import urllib.request
import urllib.parse
import threading
import time
from datetime import datetime, timedelta

# Import database module
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import init_db, get_db, calculate_next_service
from server import HomeyRequestHandler, PORT

TEST_PORT = 8089

class TestHomeyApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Initialize DB
        init_db()

    def test_database_initialization(self):
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall()]
        self.assertIn("appliances", tables)
        self.assertIn("service_history", tables)
        self.assertIn("notifications", tables)
        self.assertIn("user_settings", tables)

        # Verify seed data
        cursor.execute("SELECT COUNT(*) as cnt FROM appliances")
        count = cursor.fetchone()["cnt"]
        self.assertGreaterEqual(count, 4)
        conn.close()

    def test_calculate_next_service(self):
        today = "2026-08-29"
        # 6 months ~ 182 days
        next_date = calculate_next_service(today, 6)
        self.assertIsNotNone(next_date)
        dt = datetime.strptime(next_date, "%Y-%m-%d")
        self.assertGreater(dt, datetime.strptime(today, "%Y-%m-%d"))

    def test_appliance_crud_and_service_logging(self):
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Create Appliance
        cursor.execute("""
        INSERT INTO appliances (
            name, category, brand, model_number, purchase_date, bill_amount,
            warranty_duration_months, warranty_end_date, service_duration_months,
            last_service_date, next_service_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "Test AC Unit", "Air Conditioner", "Voltas", "183V", "2026-01-10", 550.00,
            12, "2027-01-10", 6, "2026-01-10", "2026-07-10"
        ))
        app_id = cursor.lastrowid
        self.assertIsNotNone(app_id)

        # 2. Log Service Record
        cursor.execute("""
        INSERT INTO service_history (appliance_id, service_date, service_type, cost, technician)
        VALUES (?, ?, ?, ?, ?)
        """, (app_id, "2026-08-29", "Filter Cleaning & Gas Check", 45.00, "CoolPro Tech"))
        
        # 3. Update next service date
        new_next_service = calculate_next_service("2026-08-29", 6)
        cursor.execute("UPDATE appliances SET last_service_date = ?, next_service_date = ? WHERE id = ?",
                       ("2026-08-29", new_next_service, app_id))
        conn.commit()

        # 4. Verify update
        cursor.execute("SELECT * FROM appliances WHERE id = ?", (app_id,))
        app = cursor.fetchone()
        self.assertEqual(app["name"], "Test AC Unit")
        self.assertEqual(app["last_service_date"], "2026-08-29")
        self.assertEqual(app["next_service_date"], new_next_service)

        # 5. Clean up test record
        cursor.execute("DELETE FROM appliances WHERE id = ?", (app_id,))
        cursor.execute("DELETE FROM service_history WHERE appliance_id = ?", (app_id,))
        conn.commit()
        conn.close()

if __name__ == "__main__":
    unittest.main()
