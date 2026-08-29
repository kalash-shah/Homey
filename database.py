import sqlite3
import os
import json
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "homey.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Appliances table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS appliances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        brand TEXT,
        model_number TEXT,
        serial_number TEXT,
        room TEXT,
        purchase_date TEXT,
        bill_amount REAL DEFAULT 0.0,
        bill_vendor TEXT,
        bill_number TEXT,
        warranty_duration_months INTEGER DEFAULT 12,
        warranty_end_date TEXT,
        service_duration_months INTEGER DEFAULT 6,
        last_service_date TEXT,
        next_service_date TEXT,
        notes TEXT,
        photo_url TEXT,
        warranty_photo_url TEXT,
        bill_photo_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Service history logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS service_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appliance_id INTEGER NOT NULL,
        service_date TEXT NOT NULL,
        service_type TEXT NOT NULL,
        cost REAL DEFAULT 0.0,
        technician TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (appliance_id) REFERENCES appliances (id) ON DELETE CASCADE
    );
    """)

    # Notifications / Reminders log
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appliance_id INTEGER,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL, /* 'warranty_expiry', 'service_due', 'info' */
        due_date TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (appliance_id) REFERENCES appliances (id) ON DELETE CASCADE
    );
    """)

    # User Profile / Preferences
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    # Default settings
    cursor.execute("""
    INSERT OR IGNORE INTO user_settings (key, value) VALUES 
        ('user_name', 'Alex Mercer'),
        ('email', 'alex.homey@vault.internal'),
        ('notify_warranty_days', '15'),
        ('notify_service_days', '7'),
        ('enable_push_alerts', 'true'),
        ('enable_sound', 'true'),
        ('currency', '$');
    """)

    # Seed sample appliances if empty
    cursor.execute("SELECT COUNT(*) as count FROM appliances")
    if cursor.fetchone()['count'] == 0:
        seed_sample_data(cursor)

    conn.commit()
    conn.close()

def seed_sample_data(cursor):
    today = datetime.now()
    
    # 1. Living Room AC (Service due in 5 days, warranty active)
    ac_purchase = (today - timedelta(days=200)).strftime("%Y-%m-%d")
    ac_warranty = (today + timedelta(days=165)).strftime("%Y-%m-%d")
    ac_last_service = (today - timedelta(days=85)).strftime("%Y-%m-%d")
    ac_next_service = (today + timedelta(days=5)).strftime("%Y-%m-%d")
    
    # 2. Kitchen Smart Refrigerator (Warranty expiring in 4 days)
    fridge_purchase = (today - timedelta(days=725)).strftime("%Y-%m-%d")
    fridge_warranty = (today + timedelta(days=4)).strftime("%Y-%m-%d")
    fridge_last_service = (today - timedelta(days=150)).strftime("%Y-%m-%d")
    fridge_next_service = (today + timedelta(days=30)).strftime("%Y-%m-%d")
    
    # 3. Washing Machine
    wm_purchase = (today - timedelta(days=120)).strftime("%Y-%m-%d")
    wm_warranty = (today + timedelta(days=245)).strftime("%Y-%m-%d")
    wm_last_service = (today - timedelta(days=120)).strftime("%Y-%m-%d")
    wm_next_service = (today + timedelta(days=60)).strftime("%Y-%m-%d")

    # 4. Microwave Oven
    micro_purchase = (today - timedelta(days=400)).strftime("%Y-%m-%d")
    micro_warranty = (today - timedelta(days=35)).strftime("%Y-%m-%d") # Expired
    micro_last_service = (today - timedelta(days=100)).strftime("%Y-%m-%d")
    micro_next_service = (today - timedelta(days=10)).strftime("%Y-%m-%d") # Overdue

    samples = [
        (
            "Dual Inverter Split AC", "Air Conditioner", "Daikin", "FTKM50TV", "SN-DK982341", "Master Bedroom",
            ac_purchase, 750.00, "CoolBreeze Electronics", "INV-8921",
            12, ac_warranty, 3, ac_last_service, ac_next_service,
            "Clean dust filters every month. Next comprehensive gas & coil check due soon.",
            "", "", ""
        ),
        (
            "French Door Smart Refrigerator", "Refrigerator", "Samsung", "RF28R7351SR", "SN-SM441908", "Kitchen",
            fridge_purchase, 1899.99, "Home Depot", "HD-449102",
            24, fridge_warranty, 6, fridge_last_service, fridge_next_service,
            "Twin Cooling Plus, includes water filter replacement alert.",
            "", "", ""
        ),
        (
            "Front Load Washing Machine", "Washing Machine", "Bosch", "WAW285H1UC", "SN-BS772314", "Utility Room",
            wm_purchase, 949.50, "Best Buy", "BB-102934",
            12, wm_warranty, 6, wm_last_service, wm_next_service,
            "EcoSilence Drive. Use descaling powder once every 3 months.",
            "", "", ""
        ),
        (
            "Convection Microwave Oven", "Microwave", "LG", "MJEN326PK", "SN-LG550212", "Kitchen",
            micro_purchase, 320.00, "Appliance World", "AW-7712",
            12, micro_warranty, 3, micro_last_service, micro_next_service,
            "Charcoal Lighting Heater, auto-cook menu active.",
            "", "", ""
        )
    ]

    cursor.executemany("""
    INSERT INTO appliances (
        name, category, brand, model_number, serial_number, room,
        purchase_date, bill_amount, bill_vendor, bill_number,
        warranty_duration_months, warranty_end_date, service_duration_months, last_service_date, next_service_date,
        notes, photo_url, warranty_photo_url, bill_photo_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, samples)

def calculate_next_service(last_date_str, duration_months):
    try:
        if not last_date_str:
            return None
        dt = datetime.strptime(last_date_str, "%Y-%m-%d")
        next_dt = dt + timedelta(days=int(float(duration_months) * 30.44))
        return next_dt.strftime("%Y-%m-%d")
    except Exception:
        return None
