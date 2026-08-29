/**
 * Homey Notifications & Real-Time Alert Manager
 */

class NotificationManager {
  constructor() {
    this.alerts = [];
    this.pollInterval = null;
    this.audioEnabled = true;
    this.pushEnabled = false;
    this.init();
  }

  async init() {
    this.checkPermissionStatus();
    await this.fetchAlerts();
    this.startRealtimePolling();
  }

  checkPermissionStatus() {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        this.pushEnabled = true;
        const btn = document.getElementById('enablePushBtn');
        if (btn) {
          btn.textContent = 'Alerts Active ✓';
          btn.classList.remove('btn-cyan');
          btn.classList.add('btn-outline');
          btn.disabled = true;
        }
      }
    }
  }

  async requestPermission() {
    if (!('Notification' in window)) {
      window.HomeyApp?.showToast('Web Notifications not supported on this browser', 'warning');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.pushEnabled = true;
        window.HomeyApp?.showToast('Real-time alerts enabled on device!', 'success');
        this.checkPermissionStatus();
        this.sendPushAlert('Homey Vault Connected', 'Real-time warranty & servicing alerts are now active on your phone.');
        return true;
      } else {
        window.HomeyApp?.showToast('Notification permission was not granted', 'warning');
        return false;
      }
    } catch (e) {
      console.error('Error requesting notification permission:', e);
      return false;
    }
  }

  sendPushAlert(title, body, icon = '/icons/icon-192.png') {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
              body: body,
              icon: icon,
              badge: '/icons/icon-192.png',
              vibrate: [200, 100, 200]
            });
          });
        } else {
          new Notification(title, { body, icon });
        }
      } catch (err) {
        console.error('Notification dispatch error:', err);
      }
    }
  }

  playAlertSound() {
    if (!this.audioEnabled) return;
    try {
      // Gentle synthetic audio tone using Web Audio API
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      // Audio context might be restricted before user interaction
    }
  }

  async fetchAlerts() {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      if (data.status === 'success') {
        this.alerts = data.data || [];
        this.updateBadges(data.count, data.urgent_count);
        this.renderAlertsList();
        this.updateLiveAlertBanner();
      }
    } catch (err) {
      console.warn('Failed to fetch real-time alerts:', err);
    }
  }

  updateBadges(totalCount, urgentCount) {
    const headerBellBadge = document.getElementById('headerBellBadge');
    const drawerAlertBadge = document.getElementById('drawerAlertBadge');
    const bottomNavAlertBadge = document.getElementById('bottomNavAlertBadge');
    const drawerAlertCount = document.getElementById('drawerAlertCount');
    const allAlertCount = document.getElementById('allAlertCount');
    const urgentAlertCount = document.getElementById('urgentAlertCount');
    const dueSoonAlertCount = document.getElementById('dueSoonAlertCount');

    if (totalCount > 0) {
      if (headerBellBadge) {
        headerBellBadge.textContent = totalCount;
        headerBellBadge.classList.remove('hidden');
      }
      if (drawerAlertBadge) {
        drawerAlertBadge.textContent = totalCount;
        drawerAlertBadge.classList.remove('hidden');
      }
      if (bottomNavAlertBadge) {
        bottomNavAlertBadge.textContent = totalCount;
        bottomNavAlertBadge.classList.remove('hidden');
      }
    } else {
      headerBellBadge?.classList.add('hidden');
      drawerAlertBadge?.classList.add('hidden');
      bottomNavAlertBadge?.classList.add('hidden');
    }

    if (drawerAlertCount) drawerAlertCount.textContent = totalCount;
    if (allAlertCount) allAlertCount.textContent = totalCount;
    if (urgentAlertCount) urgentAlertCount.textContent = urgentCount;
    if (dueSoonAlertCount) dueSoonAlertCount.textContent = (totalCount - urgentCount);
  }

  updateLiveAlertBanner() {
    const banner = document.getElementById('liveAlertBanner');
    const textEl = document.getElementById('liveAlertText');
    if (!banner || !textEl) return;

    if (this.alerts.length > 0) {
      const urgentAlerts = this.alerts.filter(a => a.severity === 'danger');
      if (urgentAlerts.length > 0) {
        textEl.innerHTML = `<strong>⚠️ Attention Required:</strong> ${urgentAlerts[0].title}`;
      } else {
        textEl.innerHTML = `<strong>⏰ Reminder:</strong> ${this.alerts[0].title}`;
      }
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  renderAlertsList(filter = 'all') {
    const container = document.getElementById('alertsListContainer');
    if (!container) return;

    let filtered = this.alerts;
    if (filter === 'danger') {
      filtered = this.alerts.filter(a => a.severity === 'danger');
    } else if (filter === 'warning') {
      filtered = this.alerts.filter(a => a.severity === 'warning');
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛡️</div>
          <h3 class="empty-title">All Caught Up!</h3>
          <p class="empty-desc">No pending service or warranty expiration alerts right now.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(a => {
      const iconEmoji = a.type.includes('warranty') ? '🛡️' : '🔧';
      const actionText = a.type.includes('service') ? 'Log Maintenance' : 'View Appliance';
      const actionFn = a.type.includes('service') 
        ? `window.HomeyApp.openLogServiceModal(${a.appliance_id})`
        : `window.HomeyApp.viewApplianceDetail(${a.appliance_id})`;

      return `
        <div class="alert-item-card ${a.severity}">
          <div class="alert-icon-box">${iconEmoji}</div>
          <div class="alert-content">
            <div class="alert-header-row">
              <span class="alert-card-title">${a.title}</span>
              <span class="status-badge ${a.severity}">${a.date}</span>
            </div>
            <p class="alert-card-msg">${a.message}</p>
            <div class="alert-action-btn">
              <button class="btn btn-sm btn-cyan" onclick="${actionFn}">
                ${actionText}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  startRealtimePolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    // Poll every 20 seconds for real-time reminders
    this.pollInterval = setInterval(() => {
      this.fetchAlerts();
    }, 20000);
  }
}

window.NotificationManager = NotificationManager;
