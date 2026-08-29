import http.server
import socketserver
import json
import os
import urllib.parse
import mimetypes
import base64
import uuid
import socket
from datetime import datetime, timedelta
from database import get_db, init_db, calculate_next_service

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(PUBLIC_DIR, exist_ok=True)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def compute_statuses(row_dict):
    today = datetime.now().date()
    item = dict(row_dict)
    
    # 1. Warranty Status
    warranty_end = item.get("warranty_end_date")
    if warranty_end:
        try:
            w_date = datetime.strptime(warranty_end, "%Y-%m-%d").date()
            days_left = (w_date - today).days
            item["days_until_warranty"] = days_left
            if days_left < 0:
                item["warranty_status"] = "expired"
                item["warranty_status_label"] = f"Expired ({abs(days_left)}d ago)"
                item["warranty_badge_color"] = "danger"
            elif days_left <= 15:
                item["warranty_status"] = "expiring_soon"
                item["warranty_status_label"] = f"Expiring in {days_left}d"
                item["warranty_badge_color"] = "warning"
            else:
                item["warranty_status"] = "active"
                item["warranty_status_label"] = f"Valid ({days_left}d left)"
                item["warranty_badge_color"] = "success"
        except Exception:
            item["warranty_status"] = "unknown"
            item["warranty_status_label"] = "Unknown"
            item["warranty_badge_color"] = "muted"
    else:
        item["warranty_status"] = "none"
        item["warranty_status_label"] = "No Warranty"
        item["warranty_badge_color"] = "muted"

    # 2. Service Status
    next_service = item.get("next_service_date")
    if next_service:
        try:
            s_date = datetime.strptime(next_service, "%Y-%m-%d").date()
            days_left = (s_date - today).days
            item["days_until_service"] = days_left
            if days_left < 0:
                item["service_status"] = "overdue"
                item["service_status_label"] = f"Overdue ({abs(days_left)}d)"
                item["service_badge_color"] = "danger"
            elif days_left <= 7:
                item["service_status"] = "due_soon"
                item["service_status_label"] = f"Due in {days_left}d"
                item["service_badge_color"] = "warning"
            else:
                item["service_status"] = "scheduled"
                item["service_status_label"] = f"In {days_left}d"
                item["service_badge_color"] = "success"
        except Exception:
            item["service_status"] = "unknown"
            item["service_status_label"] = "Unknown"
            item["service_badge_color"] = "muted"
    else:
        item["service_status"] = "none"
        item["service_status_label"] = "No Schedule"
        item["service_badge_color"] = "muted"

    return item

class HomeyRequestHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # CORS & Security Headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json_response(self, data, status_code=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def parse_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode('utf-8'))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # --- API ROUTES ---
        if path == "/api/appliances":
            self.handle_get_appliances(query)
        elif path.startswith("/api/appliances/"):
            app_id = path.split("/")[3]
            self.handle_get_appliance(app_id)
        elif path == "/api/notifications":
            self.handle_get_notifications()
        elif path == "/api/stats":
            self.handle_get_stats()
        elif path == "/api/settings":
            self.handle_get_settings()
        elif path == "/api/export":
            self.handle_export()
        elif path == "/api/server-info":
            self.send_json_response({
                "local_ip": get_local_ip(),
                "port": PORT,
                "server_time": datetime.now().isoformat(),
                "name": "Homey HomeVault API"
            })
        elif path.startswith("/uploads/"):
            self.serve_upload_file(path[len("/uploads/"):])
        elif path.startswith("/api/placeholder/"):
            self.serve_placeholder_image(path[len("/api/placeholder/"):])
        else:
            # Serve public static files
            self.serve_static_file(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/appliances":
            self.handle_create_appliance()
        elif path.endswith("/service") and path.startswith("/api/appliances/"):
            app_id = path.split("/")[3]
            self.handle_record_service(app_id)
        elif path == "/api/upload":
            self.handle_upload_file()
        elif path == "/api/notifications/read-all":
            self.handle_mark_notifications_read()
        elif path == "/api/settings":
            self.handle_update_settings()
        elif path == "/api/import":
            self.handle_import()
        else:
            self.send_error(404, "Not Found")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/appliances/"):
            app_id = path.split("/")[3]
            self.handle_update_appliance(app_id)
        else:
            self.send_error(404, "Not Found")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/appliances/"):
            app_id = path.split("/")[3]
            self.handle_delete_appliance(app_id)
        else:
            self.send_error(404, "Not Found")

    # --- CONTROLLER METHODS ---

    def handle_get_appliances(self, query):
        conn = get_db()
        cursor = conn.cursor()
        
        search = query.get("search", [""])[0].strip().lower()
        category = query.get("category", [""])[0].strip()
        filter_status = query.get("filter", [""])[0].strip() # 'expiring', 'service_due', 'all'
        
        cursor.execute("SELECT * FROM appliances ORDER BY id DESC")
        rows = [compute_statuses(row) for row in cursor.fetchall()]
        conn.close()

        filtered = []
        for r in rows:
            if search:
                s_str = f"{r['name']} {r['brand'] or ''} {r['model_number'] or ''} {r['room'] or ''} {r['category']}".lower()
                if search not in s_str:
                    continue
            if category and category != "All" and r["category"].lower() != category.lower():
                continue
            if filter_status == "expiring" and r["warranty_status"] not in ["expiring_soon", "expired"]:
                continue
            if filter_status == "service_due" and r["service_status"] not in ["due_soon", "overdue"]:
                continue
            filtered.append(r)

        self.send_json_response({"status": "success", "count": len(filtered), "data": filtered})

    def handle_get_appliance(self, app_id):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appliances WHERE id = ?", (app_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            self.send_json_response({"status": "error", "message": "Appliance not found"}, 404)
            return
        
        item = compute_statuses(row)
        cursor.execute("SELECT * FROM service_history WHERE appliance_id = ? ORDER BY service_date DESC", (app_id,))
        history = [dict(h) for h in cursor.fetchall()]
        item["service_history"] = history
        conn.close()

        self.send_json_response({"status": "success", "data": item})

    def handle_create_appliance(self):
        try:
            data = self.parse_json_body()
            name = data.get("name", "").strip()
            if not name:
                self.send_json_response({"status": "error", "message": "Appliance Name is required"}, 400)
                return

            category = data.get("category", "General Appliance")
            brand = data.get("brand", "")
            model_number = data.get("model_number", "")
            serial_number = data.get("serial_number", "")
            room = data.get("room", "Living Room")
            purchase_date = data.get("purchase_date") or datetime.now().strftime("%Y-%m-%d")
            bill_amount = float(data.get("bill_amount") or 0.0)
            bill_vendor = data.get("bill_vendor", "")
            bill_number = data.get("bill_number", "")
            warranty_duration_months = int(data.get("warranty_duration_months") or 12)
            
            # Calculate warranty end date if not explicitly given
            warranty_end_date = data.get("warranty_end_date")
            if not warranty_end_date and purchase_date:
                warranty_end_date = calculate_next_service(purchase_date, warranty_duration_months)

            service_duration_months = int(data.get("service_duration_months") or 6)
            last_service_date = data.get("last_service_date") or purchase_date
            
            next_service_date = data.get("next_service_date")
            if not next_service_date and last_service_date:
                next_service_date = calculate_next_service(last_service_date, service_duration_months)

            notes = data.get("notes", "")
            photo_url = data.get("photo_url", "")
            warranty_photo_url = data.get("warranty_photo_url", "")
            bill_photo_url = data.get("bill_photo_url", "")

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO appliances (
                name, category, brand, model_number, serial_number, room,
                purchase_date, bill_amount, bill_vendor, bill_number,
                warranty_duration_months, warranty_end_date,
                service_duration_months, last_service_date, next_service_date,
                notes, photo_url, warranty_photo_url, bill_photo_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name, category, brand, model_number, serial_number, room,
                purchase_date, bill_amount, bill_vendor, bill_number,
                warranty_duration_months, warranty_end_date,
                service_duration_months, last_service_date, next_service_date,
                notes, photo_url, warranty_photo_url, bill_photo_url
            ))
            new_id = cursor.lastrowid
            conn.commit()
            conn.close()

            self.send_json_response({"status": "success", "id": new_id, "message": "Appliance saved to Vault!"}, 201)
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, 500)

    def handle_update_appliance(self, app_id):
        try:
            data = self.parse_json_body()
            name = data.get("name", "").strip()
            if not name:
                self.send_json_response({"status": "error", "message": "Appliance Name is required"}, 400)
                return

            category = data.get("category", "General Appliance")
            brand = data.get("brand", "")
            model_number = data.get("model_number", "")
            serial_number = data.get("serial_number", "")
            room = data.get("room", "Living Room")
            purchase_date = data.get("purchase_date")
            bill_amount = float(data.get("bill_amount") or 0.0)
            bill_vendor = data.get("bill_vendor", "")
            bill_number = data.get("bill_number", "")
            warranty_duration_months = int(data.get("warranty_duration_months") or 12)
            warranty_end_date = data.get("warranty_end_date")
            service_duration_months = int(data.get("service_duration_months") or 6)
            last_service_date = data.get("last_service_date")
            next_service_date = data.get("next_service_date")
            notes = data.get("notes", "")
            photo_url = data.get("photo_url", "")
            warranty_photo_url = data.get("warranty_photo_url", "")
            bill_photo_url = data.get("bill_photo_url", "")

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE appliances SET
                name = ?, category = ?, brand = ?, model_number = ?, serial_number = ?, room = ?,
                purchase_date = ?, bill_amount = ?, bill_vendor = ?, bill_number = ?,
                warranty_duration_months = ?, warranty_end_date = ?,
                service_duration_months = ?, last_service_date = ?, next_service_date = ?,
                notes = ?, photo_url = ?, warranty_photo_url = ?, bill_photo_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """, (
                name, category, brand, model_number, serial_number, room,
                purchase_date, bill_amount, bill_vendor, bill_number,
                warranty_duration_months, warranty_end_date,
                service_duration_months, last_service_date, next_service_date,
                notes, photo_url, warranty_photo_url, bill_photo_url, app_id
            ))
            conn.commit()
            conn.close()

            self.send_json_response({"status": "success", "message": "Appliance updated successfully"})
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, 500)

    def handle_delete_appliance(self, app_id):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM appliances WHERE id = ?", (app_id,))
        cursor.execute("DELETE FROM service_history WHERE appliance_id = ?", (app_id,))
        cursor.execute("DELETE FROM notifications WHERE appliance_id = ?", (app_id,))
        conn.commit()
        conn.close()
        self.send_json_response({"status": "success", "message": "Appliance removed from Vault"})

    def handle_record_service(self, app_id):
        try:
            data = self.parse_json_body()
            service_date = data.get("service_date") or datetime.now().strftime("%Y-%m-%d")
            service_type = data.get("service_type", "Routine Maintenance")
            cost = float(data.get("cost") or 0.0)
            technician = data.get("technician", "")
            notes = data.get("notes", "")

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM appliances WHERE id = ?", (app_id,))
            app = cursor.fetchone()
            if not app:
                conn.close()
                self.send_json_response({"status": "error", "message": "Appliance not found"}, 404)
                return

            # Insert service record
            cursor.execute("""
            INSERT INTO service_history (appliance_id, service_date, service_type, cost, technician, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (app_id, service_date, service_type, cost, technician, notes))

            # Auto calculate and advance next service date
            interval = app["service_duration_months"] or 6
            next_date = calculate_next_service(service_date, interval)

            cursor.execute("""
            UPDATE appliances SET
                last_service_date = ?,
                next_service_date = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """, (service_date, next_date, app_id))

            conn.commit()
            conn.close()

            self.send_json_response({
                "status": "success",
                "message": f"Service logged! Next service scheduled for {next_date}",
                "next_service_date": next_date
            })
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, 500)

    def handle_get_notifications(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appliances")
        appliances = [compute_statuses(r) for r in cursor.fetchall()]
        conn.close()

        alerts = []
        for a in appliances:
            # Check warranty alerts
            if a["warranty_status"] == "expired":
                alerts.append({
                    "id": f"w-exp-{a['id']}",
                    "appliance_id": a["id"],
                    "appliance_name": a["name"],
                    "type": "warranty_expired",
                    "severity": "danger",
                    "title": f"Warranty Expired: {a['name']}",
                    "message": f"Warranty expired on {a['warranty_end_date']}. Consider extended warranty or maintenance.",
                    "date": a["warranty_end_date"],
                    "icon": "shield-alert"
                })
            elif a["warranty_status"] == "expiring_soon":
                alerts.append({
                    "id": f"w-soon-{a['id']}",
                    "appliance_id": a["id"],
                    "appliance_name": a["name"],
                    "type": "warranty_expiring",
                    "severity": "warning",
                    "title": f"Warranty Expiring Soon: {a['name']}",
                    "message": f"Expires in {a['days_until_warranty']} days ({a['warranty_end_date']}). Check for any pending issues!",
                    "date": a["warranty_end_date"],
                    "icon": "shield"
                })

            # Check service alerts
            if a["service_status"] == "overdue":
                alerts.append({
                    "id": f"s-over-{a['id']}",
                    "appliance_id": a["id"],
                    "appliance_name": a["name"],
                    "type": "service_overdue",
                    "severity": "danger",
                    "title": f"Service Overdue: {a['name']}",
                    "message": f"Maintenance was due on {a['next_service_date']} ({abs(a['days_until_service'])} days overdue).",
                    "date": a["next_service_date"],
                    "icon": "tool"
                })
            elif a["service_status"] == "due_soon":
                alerts.append({
                    "id": f"s-soon-{a['id']}",
                    "appliance_id": a["id"],
                    "appliance_name": a["name"],
                    "type": "service_due",
                    "severity": "warning",
                    "title": f"Upcoming Service: {a['name']}",
                    "message": f"Service scheduled in {a['days_until_service']} days ({a['next_service_date']}).",
                    "date": a["next_service_date"],
                    "icon": "clock"
                })

        self.send_json_response({
            "status": "success",
            "count": len(alerts),
            "urgent_count": sum(1 for x in alerts if x["severity"] == "danger"),
            "data": alerts
        })

    def handle_mark_notifications_read(self):
        self.send_json_response({"status": "success", "message": "All notifications marked as read"})

    def handle_get_stats(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appliances")
        appliances = [compute_statuses(r) for r in cursor.fetchall()]
        
        cursor.execute("SELECT SUM(cost) as total_service_cost FROM service_history")
        svc_cost = cursor.fetchone()["total_service_cost"] or 0.0
        conn.close()

        total_valuation = sum(a["bill_amount"] or 0.0 for a in appliances)
        active_warranties = sum(1 for a in appliances if a["warranty_status"] == "active")
        expiring_warranties = sum(1 for a in appliances if a["warranty_status"] == "expiring_soon")
        expired_warranties = sum(1 for a in appliances if a["warranty_status"] == "expired")
        service_due = sum(1 for a in appliances if a["service_status"] in ["due_soon", "overdue"])

        categories = {}
        for a in appliances:
            cat = a["category"]
            categories[cat] = categories.get(cat, 0) + 1

        self.send_json_response({
            "status": "success",
            "total_appliances": len(appliances),
            "total_valuation": total_valuation,
            "total_service_cost": svc_cost,
            "warranty": {
                "active": active_warranties,
                "expiring_soon": expiring_warranties,
                "expired": expired_warranties
            },
            "service_due_count": service_due,
            "categories": categories
        })

    def handle_get_settings(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM user_settings")
        settings = {r["key"]: r["value"] for r in cursor.fetchall()}
        conn.close()
        self.send_json_response({"status": "success", "data": settings})

    def handle_update_settings(self):
        data = self.parse_json_body()
        conn = get_db()
        cursor = conn.cursor()
        for k, v in data.items():
            cursor.execute("INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)", (k, str(v)))
        conn.commit()
        conn.close()
        self.send_json_response({"status": "success", "message": "Settings updated"})

    def handle_upload_file(self):
        try:
            data = self.parse_json_body()
            base64_data = data.get("image")
            filename = data.get("filename", f"photo_{uuid.uuid4().hex[:8]}.jpg")
            
            if not base64_data:
                self.send_json_response({"status": "error", "message": "No image data provided"}, 400)
                return

            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]

            file_bytes = base64.b64decode(base64_data)
            clean_filename = f"{uuid.uuid4().hex[:10]}_{os.path.basename(filename)}"
            file_path = os.path.join(UPLOADS_DIR, clean_filename)
            
            with open(file_path, "wb") as f:
                f.write(file_bytes)

            self.send_json_response({
                "status": "success",
                "url": f"/uploads/{clean_filename}",
                "message": "File uploaded successfully"
            })
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, 500)

    def handle_export(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appliances")
        appliances = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM service_history")
        history = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM user_settings")
        settings = {r["key"]: r["value"] for r in cursor.fetchall()}
        conn.close()

        export_data = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "appliances": appliances,
            "service_history": history,
            "settings": settings
        }
        self.send_json_response(export_data)

    def handle_import(self):
        try:
            data = self.parse_json_body()
            appliances = data.get("appliances", [])
            conn = get_db()
            cursor = conn.cursor()
            
            for a in appliances:
                cursor.execute("""
                INSERT OR REPLACE INTO appliances (
                    id, name, category, brand, model_number, serial_number, room,
                    purchase_date, bill_amount, bill_vendor, bill_number,
                    warranty_duration_months, warranty_end_date,
                    service_duration_months, last_service_date, next_service_date,
                    notes, photo_url, warranty_photo_url, bill_photo_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    a.get("id"), a.get("name"), a.get("category"), a.get("brand"), a.get("model_number"),
                    a.get("serial_number"), a.get("room"), a.get("purchase_date"), a.get("bill_amount", 0.0),
                    a.get("bill_vendor"), a.get("bill_number"), a.get("warranty_duration_months", 12),
                    a.get("warranty_end_date"), a.get("service_duration_months", 6),
                    a.get("last_service_date"), a.get("next_service_date"), a.get("notes"),
                    a.get("photo_url"), a.get("warranty_photo_url"), a.get("bill_photo_url")
                ))
            conn.commit()
            conn.close()
            self.send_json_response({"status": "success", "message": f"Imported {len(appliances)} appliances!"})
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, 500)

    def serve_upload_file(self, filename):
        file_path = os.path.join(UPLOADS_DIR, filename)
        if not os.path.exists(file_path):
            self.send_error(404, "File Not Found")
            return
        
        mime_type, _ = mimetypes.guess_type(file_path)
        mime_type = mime_type or "application/octet-stream"
        
        with open(file_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_placeholder_image(self, name):
        # Generate lightweight high-tech SVG placeholder graphics
        colors = {
            "ac.jpg": ("#0A192F", "#00F0FF", "Air Conditioner", "❄️"),
            "fridge.jpg": ("#111936", "#38BDF8", "Smart Refrigerator", "🧊"),
            "washing_machine.jpg": ("#0F172A", "#818CF8", "Washing Machine", "🫧"),
            "microwave.jpg": ("#1E1B4B", "#F43F5E", "Microwave Oven", "⚡"),
            "ac_warranty.jpg": ("#064E3B", "#34D399", "AC Warranty Card", "🛡️"),
            "fridge_warranty.jpg": ("#14532D", "#4ADE80", "Samsung Care+", "🛡️"),
            "wm_warranty.jpg": ("#065F46", "#10B981", "Bosch Protection", "🛡️"),
            "micro_warranty.jpg": ("#701A75", "#F472B6", "LG Warranty 1-Yr", "🛡️"),
            "ac_bill.jpg": ("#1E293B", "#94A3B8", "Invoice #INV-8921", "🧾"),
            "fridge_bill.jpg": ("#1E293B", "#94A3B8", "Receipt #HD-449102", "🧾"),
            "wm_bill.jpg": ("#1E293B", "#94A3B8", "Receipt #BB-102934", "🧾"),
            "micro_bill.jpg": ("#1E293B", "#94A3B8", "Invoice #AW-7712", "🧾"),
        }
        bg, accent, title, emoji = colors.get(name, ("#18181B", "#A1A1AA", "Homey Vault Item", "📦"))
        
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="100%" height="100%">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="{bg}" />
                    <stop offset="100%" stop-color="#090D16" />
                </linearGradient>
                <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="{accent}" stroke-width="0.5" opacity="0.15"/>
                </pattern>
            </defs>
            <rect width="600" height="400" fill="url(#grad)" />
            <rect width="600" height="400" fill="url(#grid)" />
            <circle cx="300" cy="170" r="70" fill="{accent}" opacity="0.12" />
            <text x="300" y="195" font-size="64" text-anchor="middle" font-family="sans-serif">{emoji}</text>
            <text x="300" y="270" font-size="22" font-weight="700" fill="#FFFFFF" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">{title}</text>
            <text x="300" y="300" font-size="14" fill="{accent}" text-anchor="middle" letter-spacing="2" font-family="sans-serif">HOMEY SECURE VAULT</text>
        </svg>"""
        
        body = svg.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static_file(self, req_path):
        if req_path == "/" or not req_path:
            req_path = "/index.html"

        # Remove leading slash
        clean_path = req_path.lstrip("/")
        full_path = os.path.join(PUBLIC_DIR, clean_path)

        if not os.path.exists(full_path) or os.path.isdir(full_path):
            full_path = os.path.join(PUBLIC_DIR, "index.html")

        mime_type, _ = mimetypes.guess_type(full_path)
        mime_type = mime_type or "text/html"

        try:
            with open(full_path, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_error(404, "File Not Found")

def run_server(port=PORT):
    init_db()
    server_address = ('0.0.0.0', port)
    httpd = socketserver.TCPServer(server_address, HomeyRequestHandler)
    local_ip = get_local_ip()
    print(f"🏠 Homey Server is running!")
    print(f"🔗 Local URL:  http://localhost:{port}")
    print(f"📱 Phone URL:  http://{local_ip}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
