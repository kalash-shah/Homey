import unittest
import urllib.request
import urllib.parse
import json
import threading
import time
import socketserver
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from server import HomeyRequestHandler, PORT
from database import init_db

TEST_PORT = 8092

class TestApiEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.httpd = socketserver.TCPServer(('127.0.0.1', TEST_PORT), HomeyRequestHandler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.5)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_get_appliances(self):
        url = f"http://127.0.0.1:{TEST_PORT}/api/appliances"
        req = urllib.request.urlopen(url)
        self.assertEqual(req.status, 200)
        data = json.loads(req.read().decode('utf-8'))
        self.assertEqual(data["status"], "success")
        self.assertGreater(len(data["data"]), 0)

    def test_create_and_service_flow(self):
        # 1. Create new appliance
        url = f"http://127.0.0.1:{TEST_PORT}/api/appliances"
        payload = {
            "name": "Smart Water Purifier RO",
            "category": "Water Purifier",
            "brand": "Kent",
            "model_number": "Grand Plus",
            "room": "Kitchen",
            "purchase_date": "2026-03-01",
            "bill_amount": 280.00,
            "bill_vendor": "Kent Direct",
            "bill_number": "KD-9981",
            "warranty_duration_months": 12,
            "warranty_end_date": "2027-03-01",
            "service_duration_months": 3,
            "last_service_date": "2026-03-01",
            "next_service_date": "2026-06-01",
            "notes": "Sediment & carbon filter changed during install"
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        res = urllib.request.urlopen(req)
        self.assertEqual(res.status, 201)
        created = json.loads(res.read().decode('utf-8'))
        app_id = created["id"]

        # 2. Log a service event
        svc_url = f"http://127.0.0.1:{TEST_PORT}/api/appliances/{app_id}/service"
        svc_payload = {
            "service_date": "2026-08-29",
            "service_type": "Filter Replacement",
            "cost": 35.0,
            "technician": "Kent Certified Tech",
            "notes": "Changed RO membrane and carbon filter."
        }
        svc_req = urllib.request.Request(
            svc_url,
            data=json.dumps(svc_payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        svc_res = urllib.request.urlopen(svc_req)
        self.assertEqual(svc_res.status, 200)
        svc_data = json.loads(svc_res.read().decode('utf-8'))
        self.assertEqual(svc_data["status"], "success")
        self.assertIn("next_service_date", svc_data)

        # 3. Check notifications
        notif_url = f"http://127.0.0.1:{TEST_PORT}/api/notifications"
        notif_res = urllib.request.urlopen(notif_url)
        notif_data = json.loads(notif_res.read().decode('utf-8'))
        self.assertEqual(notif_data["status"], "success")

        # 4. Check stats
        stats_url = f"http://127.0.0.1:{TEST_PORT}/api/stats"
        stats_res = urllib.request.urlopen(stats_url)
        stats_data = json.loads(stats_res.read().decode('utf-8'))
        self.assertEqual(stats_data["status"], "success")
        self.assertGreater(stats_data["total_valuation"], 0)

        # 5. Delete test appliance
        del_req = urllib.request.Request(f"http://127.0.0.1:{TEST_PORT}/api/appliances/{app_id}", method='DELETE')
        del_res = urllib.request.urlopen(del_req)
        self.assertEqual(del_res.status, 200)

    def test_static_files(self):
        index_url = f"http://127.0.0.1:{TEST_PORT}/index.html"
        res = urllib.request.urlopen(index_url)
        self.assertEqual(res.status, 200)
        content = res.read().decode('utf-8')
        self.assertIn("Homey", content)
        self.assertIn("sidebar-drawer", content)

if __name__ == "__main__":
    unittest.main()
