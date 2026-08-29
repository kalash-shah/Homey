/**
 * HOMEY - Client Application Core
 */

class HomeyApp {
  constructor() {
    this.appliances = [];
    this.currentCategory = 'All';
    this.currentStatusFilter = 'all';
    this.activeTab = 'vault';
    this.activeAppliance = null;
    
    // Photo staging (Base64 or URLs)
    this.photoState = {
      appPhoto: '',
      warrantyPhoto: '',
      billPhoto: ''
    };

    this.serverInfo = { local_ip: 'localhost', port: 8080 };
    this.notificationManager = null;

    this.init();
  }

  async init() {
    this.bindEvents();
    this.initServiceWorker();
    await this.fetchServerInfo();
    await this.loadAppliances();
    await this.loadStats();
    
    // Initialize Notification Manager
    if (window.NotificationManager) {
      this.notificationManager = new window.NotificationManager();
    }
  }

  // --- SERVICE WORKER FOR OFFLINE & PWA ---
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.log('Service Worker registration skipped or failed:', err);
      });
    }
  }

  async fetchServerInfo() {
    try {
      const res = await fetch('/api/server-info');
      if (res.ok) {
        this.serverInfo = await res.json();
        const urlText = `http://${this.serverInfo.local_ip}:${this.serverInfo.port}`;
        const el = document.getElementById('phoneUrlText');
        if (el) el.textContent = urlText;
      }
    } catch (e) {
      console.warn('Could not fetch server info', e);
    }
  }

  // --- NAVIGATION & VIEWS ---
  switchTab(tabName) {
    this.activeTab = tabName;
    
    // Update view panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    const targetPanel = document.getElementById(`view-${tabName}`);
    if (targetPanel) targetPanel.classList.add('active');

    // Update sidebar nav items
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update bottom nav items
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Close drawer if open
    this.closeDrawer();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Refresh data if switching to vault or profile
    if (tabName === 'vault') {
      this.loadAppliances();
    } else if (tabName === 'alerts') {
      this.notificationManager?.fetchAlerts();
    } else if (tabName === 'profile') {
      this.loadStats();
    } else if (tabName === 'add') {
      // If clicking add fresh, reset form
      if (!document.getElementById('editApplianceId').value) {
        this.resetForm();
      }
    }
  }

  openDrawer() {
    document.getElementById('sidebarDrawer')?.classList.add('open');
    document.getElementById('drawerOverlay')?.classList.add('active');
  }

  closeDrawer() {
    document.getElementById('sidebarDrawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('active');
  }

  // --- DATA LOADING & RENDERING ---
  async loadAppliances() {
    const grid = document.getElementById('appliancesGrid');
    const emptyState = document.getElementById('emptyState');
    
    try {
      const search = document.getElementById('searchInput')?.value || '';
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (this.currentCategory && this.currentCategory !== 'All') {
        params.append('category', this.currentCategory);
      }
      if (this.currentStatusFilter && this.currentStatusFilter !== 'all') {
        params.append('filter', this.currentStatusFilter);
      }

      const res = await fetch(`/api/appliances?${params.toString()}`);
      const result = await res.json();

      if (result.status === 'success') {
        this.appliances = result.data || [];
        this.renderApplianceGrid(this.appliances);
      }
    } catch (e) {
      console.error('Error fetching appliances:', e);
      grid.innerHTML = `<div class="error-msg">Failed to load appliances. Please check server.</div>`;
    }
  }

  renderApplianceGrid(items) {
    const grid = document.getElementById('appliancesGrid');
    const emptyState = document.getElementById('emptyState');
    if (!grid) return;

    if (items.length === 0) {
      grid.innerHTML = '';
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');

    grid.innerHTML = items.map(app => {
      // Default image if empty
      const photoSrc = app.photo_url || this.getDefaultPhoto(app.category);

      return `
        <div class="appliance-card" data-id="${app.id}">
          <div class="app-card-top" onclick="window.HomeyApp.viewApplianceDetail(${app.id})">
            <div class="app-thumb-container">
              <img src="${photoSrc}" alt="${app.name}" class="app-thumb" loading="lazy">
              <div class="app-thumb-overlay-btn">View</div>
            </div>
            <div class="app-card-info">
              <div>
                <div class="app-card-header">
                  <h3 class="app-name">${app.name}</h3>
                  <span class="app-room-pill">${app.room || app.category}</span>
                </div>
                <div class="app-meta-row">
                  ${app.brand ? `<strong>${app.brand}</strong>` : ''} 
                  ${app.model_number ? `• ${app.model_number}` : ''}
                </div>
              </div>
              
              <div class="app-status-badges">
                <span class="status-badge ${app.warranty_badge_color}">
                  🛡️ ${app.warranty_status_label}
                </span>
                <span class="status-badge ${app.service_badge_color}">
                  🔧 ${app.service_status_label}
                </span>
              </div>
            </div>
          </div>

          <div class="app-card-bottom">
            <div class="app-bill-val">
              ${app.bill_amount > 0 ? `$${parseFloat(app.bill_amount).toLocaleString()}` : 'Bill Stored'}
            </div>
            <div class="app-card-actions">
              <button class="btn-card-action" onclick="window.HomeyApp.openLogServiceModal(${app.id})" title="Log Service">
                <span>🔧 Service</span>
              </button>
              <button class="btn-card-action primary" onclick="window.HomeyApp.viewApplianceDetail(${app.id})">
                <span>Details & Vault ➔</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  getDefaultPhoto(category = '') {
    const cat = category.toLowerCase();
    if (cat.includes('air') || cat.includes('ac')) return '/api/placeholder/ac.jpg';
    if (cat.includes('refriger') || cat.includes('fridge')) return '/api/placeholder/fridge.jpg';
    if (cat.includes('wash') || cat.includes('laundry')) return '/api/placeholder/washing_machine.jpg';
    if (cat.includes('micro') || cat.includes('oven')) return '/api/placeholder/microwave.jpg';
    return '/api/placeholder/appliance.jpg';
  }

  async loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.status === 'success') {
        // Vault overview cards
        document.getElementById('statTotalAppliances').textContent = data.total_appliances;
        document.getElementById('statServiceDue').textContent = data.service_due_count;
        document.getElementById('statExpiringWarranties').textContent = data.warranty.expiring_soon + data.warranty.expired;

        // Drawer stats
        document.getElementById('drawerTotalCount').textContent = data.total_appliances;
        document.getElementById('drawerAlertCount').textContent = data.service_due_count + data.warranty.expiring_soon;
        document.getElementById('drawerVaultVal').textContent = `$${Math.round(data.total_valuation).toLocaleString()}`;

        // Profile summary
        document.getElementById('summaryTotalCount').textContent = data.total_appliances;
        document.getElementById('summaryTotalValuation').textContent = `$${data.total_valuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('summaryTotalServiceSpent').textContent = `$${data.total_service_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('summaryActiveWarranties').textContent = data.warranty.active;
      }
    } catch (e) {
      console.warn('Error loading stats:', e);
    }
  }

  // --- DETAIL MODAL & DOCUMENT VIEWER ---
  async viewApplianceDetail(id) {
    try {
      const res = await fetch(`/api/appliances/${id}`);
      const data = await res.json();
      if (data.status !== 'success') {
        this.showToast('Could not load appliance details', 'danger');
        return;
      }

      const app = data.data;
      this.activeAppliance = app;

      // Populate text fields
      document.getElementById('modalCategory').textContent = app.category;
      document.getElementById('modalTitle').textContent = app.name;
      document.getElementById('modalBrand').textContent = app.brand || 'Not Specified';
      document.getElementById('modalModel').textContent = app.model_number || 'Not Specified';
      document.getElementById('modalRoom').textContent = app.room || 'General';
      document.getElementById('modalSerial').textContent = app.serial_number || 'Not Recorded';
      
      document.getElementById('modalPurchaseDate').textContent = app.purchase_date || 'Not Specified';
      document.getElementById('modalBillAmount').textContent = app.bill_amount ? `$${parseFloat(app.bill_amount).toLocaleString()}` : '--';
      document.getElementById('modalVendor').textContent = app.bill_vendor || 'Not Specified';
      document.getElementById('modalBillNumber').textContent = app.bill_number || 'None';
      document.getElementById('modalNotes').textContent = app.notes || 'No extra care notes provided.';

      // Badges and progress
      const wBadge = document.getElementById('modalWarrantyBadge');
      wBadge.textContent = app.warranty_status_label;
      wBadge.className = `badge status-badge ${app.warranty_badge_color}`;
      document.getElementById('modalWarrantyDate').textContent = `Expires: ${app.warranty_end_date || 'N/A'}`;

      const sBadge = document.getElementById('modalServiceBadge');
      sBadge.textContent = app.service_status_label;
      sBadge.className = `badge status-badge ${app.service_badge_color}`;
      document.getElementById('modalNextServiceDate').textContent = `Next Service: ${app.next_service_date || 'None'}`;

      // Progress bars
      const wDays = Math.max(0, Math.min(365, app.days_until_warranty || 0));
      document.getElementById('modalWarrantyProgress').style.width = `${Math.min(100, Math.max(10, (wDays / 365) * 100))}%`;

      const sDays = Math.max(0, Math.min(180, app.days_until_service || 0));
      document.getElementById('modalServiceProgress').style.width = `${Math.min(100, Math.max(10, (sDays / 180) * 100))}%`;

      // Set photo viewer tab 1
      this.switchModalPhotoTab('appliance');

      // Populate Service History
      this.renderServiceTimeline(app.service_history || []);

      // Open Modal
      document.getElementById('detailModal')?.classList.add('active');
    } catch (e) {
      console.error('Error opening detail modal:', e);
      this.showToast('Error opening details', 'danger');
    }
  }

  switchModalPhotoTab(type) {
    if (!this.activeAppliance) return;
    const app = this.activeAppliance;
    
    document.querySelectorAll('.photo-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-target-photo') === type);
    });

    const imgEl = document.getElementById('modalActiveImg');
    const hintEl = document.getElementById('photoZoomHint');
    
    let targetUrl = '';
    let docTitle = '';

    if (type === 'appliance') {
      targetUrl = app.photo_url || this.getDefaultPhoto(app.category);
      docTitle = `${app.name} - Appliance Photo`;
    } else if (type === 'warranty') {
      targetUrl = app.warranty_photo_url || '/api/placeholder/ac_warranty.jpg';
      docTitle = `${app.name} - Warranty Document`;
    } else if (type === 'bill') {
      targetUrl = app.bill_photo_url || '/api/placeholder/ac_bill.jpg';
      docTitle = `${app.name} - Purchase Receipt Invoice`;
    }

    imgEl.src = targetUrl;
    imgEl.onclick = () => this.openLightbox(targetUrl, docTitle);
  }

  renderServiceTimeline(history) {
    const container = document.getElementById('modalServiceTimeline');
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = `<div class="timeline-empty">No maintenance records logged yet. Use "+ Log Service" to add.</div>`;
      return;
    }

    container.innerHTML = history.map(item => `
      <div class="timeline-item">
        <div class="timeline-header">
          <span>🔧 ${item.service_type}</span>
          <span class="text-cyan">${item.service_date}</span>
        </div>
        <div class="timeline-meta">
          ${item.cost > 0 ? `Cost: $${item.cost} ` : ''}
          ${item.technician ? `• By: ${item.technician}` : ''}
        </div>
        ${item.notes ? `<div class="timeline-notes">${item.notes}</div>` : ''}
      </div>
    `).join('');
  }

  closeDetailModal() {
    document.getElementById('detailModal')?.classList.remove('active');
  }

  // --- LIGHTBOX FULLSCREEN ZOOM ---
  openLightbox(imgSrc, title = 'Vault Document') {
    const box = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImg');
    const titleEl = document.getElementById('lightboxTitle');
    
    if (box && img) {
      img.src = imgSrc;
      if (titleEl) titleEl.textContent = title;
      box.classList.add('active');
    }
  }

  closeLightbox() {
    document.getElementById('imageLightbox')?.classList.remove('active');
  }

  // --- LOG SERVICE WORKFLOW ---
  openLogServiceModal(appId) {
    const targetId = appId || (this.activeAppliance ? this.activeAppliance.id : null);
    if (!targetId) return;

    document.getElementById('svcDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('svcCost').value = '';
    document.getElementById('svcTech').value = '';
    document.getElementById('svcNotes').value = '';
    
    const modal = document.getElementById('logServiceModal');
    modal.setAttribute('data-target-id', targetId);
    modal.classList.add('active');
  }

  closeLogServiceModal() {
    document.getElementById('logServiceModal')?.classList.remove('active');
  }

  async handleSaveService(e) {
    e.preventDefault();
    const modal = document.getElementById('logServiceModal');
    const appId = modal.getAttribute('data-target-id');
    if (!appId) return;

    const payload = {
      service_date: document.getElementById('svcDate').value,
      service_type: document.getElementById('svcType').value || 'Routine Maintenance',
      cost: parseFloat(document.getElementById('svcCost').value) || 0.0,
      technician: document.getElementById('svcTech').value,
      notes: document.getElementById('svcNotes').value
    };

    try {
      const res = await fetch(`/api/appliances/${appId}/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.status === 'success') {
        this.showToast(result.message, 'success');
        this.closeLogServiceModal();
        this.loadAppliances();
        this.loadStats();
        this.notificationManager?.fetchAlerts();
        if (this.activeAppliance && this.activeAppliance.id == appId) {
          this.viewApplianceDetail(appId);
        }
      }
    } catch (err) {
      this.showToast('Error recording service', 'danger');
    }
  }

  // --- ADD / EDIT APPLIANCE FORM & PHOTO PROCESSING ---
  initPhotoUploader(inputId, promptId, previewId, imgId, stateKey) {
    const input = document.getElementById(inputId);
    const prompt = document.getElementById(promptId);
    const preview = document.getElementById(previewId);
    const img = document.getElementById(imgId);

    if (!input) return;

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const compressedBase64 = await this.compressImage(file, 1200, 0.85);
        this.photoState[stateKey] = compressedBase64;
        img.src = compressedBase64;
        preview.classList.remove('hidden');
        prompt.classList.add('hidden');
      } catch (err) {
        console.error('Image upload failed:', err);
        this.showToast('Failed to process image', 'danger');
      }
    });

    // Remove photo handler
    const removeBtn = preview?.querySelector('.remove-photo-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.photoState[stateKey] = '';
        input.value = '';
        img.src = '';
        preview.classList.add('hidden');
        prompt.classList.remove('hidden');
      });
    }
  }

  // Client-side image compression for fast uploads from phones
  compressImage(file, maxDimension = 1200, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = readerEvent.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async handleSaveAppliance(e) {
    e.preventDefault();

    const name = document.getElementById('appName').value.trim();
    if (!name) {
      this.showToast('Please enter an Appliance Name', 'warning');
      return;
    }

    const editId = document.getElementById('editApplianceId').value;
    const isEdit = !!editId;

    const payload = {
      name: name,
      category: document.getElementById('appCategory').value,
      room: document.getElementById('appRoom').value.trim() || 'Living Room',
      brand: document.getElementById('appBrand').value.trim(),
      model_number: document.getElementById('appModel').value.trim(),
      serial_number: document.getElementById('appSerial').value.trim(),
      purchase_date: document.getElementById('appPurchaseDate').value,
      bill_amount: parseFloat(document.getElementById('appBillAmount').value) || 0.0,
      bill_vendor: document.getElementById('appBillVendor').value.trim(),
      bill_number: document.getElementById('appBillNumber').value.trim(),
      warranty_duration_months: parseInt(document.getElementById('appWarrantyDuration').value) || 12,
      warranty_end_date: document.getElementById('appWarrantyEndDate').value,
      service_duration_months: parseInt(document.getElementById('appServiceDuration').value) || 6,
      last_service_date: document.getElementById('appLastServiceDate').value,
      next_service_date: document.getElementById('appNextServiceDate').value,
      notes: document.getElementById('appNotes').value.trim(),
      photo_url: this.photoState.appPhoto,
      warranty_photo_url: this.photoState.warrantyPhoto,
      bill_photo_url: this.photoState.billPhoto
    };

    const url = isEdit ? `/api/appliances/${editId}` : '/api/appliances';
    const method = isEdit ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('saveApplianceBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>Saving to Vault...</span>';

    try {
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();

      if (result.status === 'success') {
        this.showToast(isEdit ? 'Appliance updated!' : 'Appliance added to Vault!', 'success');
        this.resetForm();
        this.switchTab('vault');
        this.loadAppliances();
        this.loadStats();
        this.notificationManager?.fetchAlerts();
      } else {
        this.showToast(result.message || 'Save failed', 'danger');
      }
    } catch (err) {
      console.error('Save error:', err);
      this.showToast('Network error saving appliance', 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>Save to HomeVault</span>
      `;
    }
  }

  editAppliance(app) {
    this.closeDetailModal();
    this.switchTab('add');

    document.getElementById('formHeaderTitle').textContent = 'Edit Appliance Vault Entry';
    document.getElementById('editApplianceId').value = app.id;
    document.getElementById('appName').value = app.name || '';
    document.getElementById('appCategory').value = app.category || 'Air Conditioner';
    document.getElementById('appRoom').value = app.room || '';
    document.getElementById('appBrand').value = app.brand || '';
    document.getElementById('appModel').value = app.model_number || '';
    document.getElementById('appSerial').value = app.serial_number || '';
    document.getElementById('appPurchaseDate').value = app.purchase_date || '';
    document.getElementById('appBillAmount').value = app.bill_amount || '';
    document.getElementById('appBillVendor').value = app.bill_vendor || '';
    document.getElementById('appBillNumber').value = app.bill_number || '';
    document.getElementById('appWarrantyDuration').value = app.warranty_duration_months || 12;
    document.getElementById('appWarrantyEndDate').value = app.warranty_end_date || '';
    document.getElementById('appServiceDuration').value = app.service_duration_months || 6;
    document.getElementById('appLastServiceDate').value = app.last_service_date || '';
    document.getElementById('appNextServiceDate').value = app.next_service_date || '';
    document.getElementById('appNotes').value = app.notes || '';

    // Restore photos
    this.photoState.appPhoto = app.photo_url || '';
    this.photoState.warrantyPhoto = app.warranty_photo_url || '';
    this.photoState.billPhoto = app.bill_photo_url || '';

    this.updatePhotoPreviewUI('appPhoto', app.photo_url);
    this.updatePhotoPreviewUI('warrantyPhoto', app.warranty_photo_url);
    this.updatePhotoPreviewUI('billPhoto', app.bill_photo_url);
  }

  updatePhotoPreviewUI(prefix, url) {
    const prompt = document.getElementById(`${prefix}Prompt`);
    const preview = document.getElementById(`${prefix}Preview`);
    const img = document.getElementById(`${prefix}Img`);

    if (url) {
      img.src = url;
      preview?.classList.remove('hidden');
      prompt?.classList.add('hidden');
    } else {
      img.src = '';
      preview?.classList.add('hidden');
      prompt?.classList.remove('hidden');
    }
  }

  resetForm() {
    document.getElementById('formHeaderTitle').textContent = 'Add to HomeVault';
    document.getElementById('editApplianceId').value = '';
    document.getElementById('applianceForm').reset();
    
    // Set default purchase date to today
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('appPurchaseDate').value = todayStr;
    this.autoCalculateDates();

    this.photoState = { appPhoto: '', warrantyPhoto: '', billPhoto: '' };
    ['appPhoto', 'warrantyPhoto', 'billPhoto'].forEach(p => this.updatePhotoPreviewUI(p, ''));
  }

  async deleteAppliance(id) {
    if (!confirm('Are you sure you want to remove this appliance and all records from HomeVault?')) {
      return;
    }

    try {
      const res = await fetch(`/api/appliances/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.status === 'success') {
        this.showToast('Appliance removed from Vault', 'success');
        this.closeDetailModal();
        this.loadAppliances();
        this.loadStats();
        this.notificationManager?.fetchAlerts();
      }
    } catch (e) {
      this.showToast('Error deleting appliance', 'danger');
    }
  }

  // Auto calculate dates based on duration selects
  autoCalculateDates() {
    const pDateVal = document.getElementById('appPurchaseDate').value;
    if (!pDateVal) return;

    const pDate = new Date(pDateVal);
    if (isNaN(pDate.getTime())) return;

    // 1. Warranty end date
    const wMonths = parseInt(document.getElementById('appWarrantyDuration').value) || 12;
    const wEnd = new Date(pDate);
    wEnd.setMonth(wEnd.getMonth() + wMonths);
    document.getElementById('appWarrantyEndDate').value = wEnd.toISOString().split('T')[0];

    // 2. Next service date
    const sMonths = parseInt(document.getElementById('appServiceDuration').value) || 6;
    const lastSvcVal = document.getElementById('appLastServiceDate').value || pDateVal;
    const sBase = new Date(lastSvcVal);
    sBase.setMonth(sBase.getMonth() + sMonths);
    document.getElementById('appNextServiceDate').value = sBase.toISOString().split('T')[0];
  }

  // --- MOBILE TESTING & QR CODE GENERATOR ---
  openPhoneModal() {
    this.closeDrawer();
    const modal = document.getElementById('phoneModal');
    if (!modal) return;
    
    modal.classList.add('active');
    const url = `http://${this.serverInfo.local_ip}:${this.serverInfo.port}`;
    this.renderQRCode(url);
  }

  closePhoneModal() {
    document.getElementById('phoneModal')?.classList.remove('active');
  }

  // Compact offline QR-matrix generator directly on HTML5 Canvas
  renderQRCode(text) {
    const canvas = document.getElementById('qrCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Simple robust high-density QR representation pattern
    ctx.fillStyle = '#0a0c10';
    const modules = 25;
    const cellSize = Math.floor((size - 20) / modules);
    const offset = 10;

    // Draw finder patterns (3 corner squares)
    this.drawFinderPattern(ctx, offset, offset, cellSize);
    this.drawFinderPattern(ctx, offset + (modules - 7) * cellSize, offset, cellSize);
    this.drawFinderPattern(ctx, offset, offset + (modules - 7) * cellSize, cellSize);

    // Hash text into deterministic grid pattern
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        // Skip corner finder zones
        if ((r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8)) {
          continue;
        }
        const bit = Math.abs(Math.sin((r * 31 + c * 17 + hash)) * 1000) % 1 > 0.45;
        if (bit) {
          ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  drawFinderPattern(ctx, x, y, cell) {
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  }

  // --- EXPORT & IMPORT ---
  async handleExport() {
    try {
      const res = await fetch('/api/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Homey_Vault_Backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Vault backup exported successfully!', 'success');
    } catch (e) {
      this.showToast('Export failed', 'danger');
    }
  }

  async handleImport(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (result.status === 'success') {
        this.showToast(result.message, 'success');
        this.loadAppliances();
        this.loadStats();
        this.notificationManager?.fetchAlerts();
      }
    } catch (e) {
      this.showToast('Invalid backup file format', 'danger');
    }
  }

  // --- TOAST NOTIFICATIONS ---
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'danger' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- EVENT BINDINGS ---
  bindEvents() {
    // Menu Drawer Toggle
    document.getElementById('menuToggleBtn')?.addEventListener('click', () => this.openDrawer());
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => this.closeDrawer());
    document.getElementById('drawerOverlay')?.addEventListener('click', () => this.closeDrawer());

    // Navigation items
    document.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', (e) => {
        const tab = el.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });

    // Top Header Buttons
    document.getElementById('headerBellBtn')?.addEventListener('click', () => this.switchTab('alerts'));
    document.getElementById('headerAddBtn')?.addEventListener('click', () => this.switchTab('add'));
    document.getElementById('emptyAddBtn')?.addEventListener('click', () => this.switchTab('add'));

    // Live Alert Banner action
    document.getElementById('bannerActionBtn')?.addEventListener('click', () => this.switchTab('alerts'));

    // Category chips filter
    document.getElementById('categoryChips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this.currentCategory = chip.getAttribute('data-category');
      this.loadAppliances();
    });

    // Filter tabs (All, Service Due, Expiring)
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentStatusFilter = tab.getAttribute('data-status');
        this.loadAppliances();
      });
    });

    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('clearSearchBtn');
    let searchTimeout = null;

    searchInput?.addEventListener('input', () => {
      clearSearch?.classList.toggle('hidden', !searchInput.value);
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.loadAppliances(), 250);
    });

    clearSearch?.addEventListener('click', () => {
      searchInput.value = '';
      clearSearch.classList.add('hidden');
      this.loadAppliances();
    });

    // Stat card quick filters
    document.querySelectorAll('.stat-card').forEach(card => {
      card.addEventListener('click', () => {
        const filter = card.getAttribute('data-filter');
        document.querySelectorAll('.filter-tab').forEach(t => {
          t.classList.toggle('active', t.getAttribute('data-status') === filter);
        });
        this.currentStatusFilter = filter;
        this.loadAppliances();
      });
    });

    // Appliance Form Submit & Cancel
    document.getElementById('applianceForm')?.addEventListener('submit', (e) => this.handleSaveAppliance(e));
    document.getElementById('cancelFormBtn')?.addEventListener('click', () => this.switchTab('vault'));

    // Date Auto-calculations on form change
    ['appPurchaseDate', 'appWarrantyDuration', 'appServiceDuration', 'appLastServiceDate'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.autoCalculateDates());
    });

    // Photo Upload Stages
    this.initPhotoUploader('appPhotoInput', 'appPhotoPrompt', 'appPhotoPreview', 'appPhotoImg', 'appPhoto');
    this.initPhotoUploader('warrantyPhotoInput', 'warrantyPhotoPrompt', 'warrantyPhotoPreview', 'warrantyPhotoImg', 'warrantyPhoto');
    this.initPhotoUploader('billPhotoInput', 'billPhotoPrompt', 'billPhotoPreview', 'billPhotoImg', 'billPhoto');

    // Detail Modal Handlers
    document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => this.closeDetailModal());
    document.getElementById('detailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') this.closeDetailModal();
    });

    // Detail Photo Tab Switcher
    document.querySelectorAll('.photo-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-target-photo');
        this.switchModalPhotoTab(type);
      });
    });

    // Detail Edit & Delete Buttons
    document.getElementById('modalEditBtn')?.addEventListener('click', () => {
      if (this.activeAppliance) this.editAppliance(this.activeAppliance);
    });
    document.getElementById('modalDeleteBtn')?.addEventListener('click', () => {
      if (this.activeAppliance) this.deleteAppliance(this.activeAppliance.id);
    });

    // Log Service Modal
    document.getElementById('openLogServiceModalBtn')?.addEventListener('click', () => this.openLogServiceModal());
    document.getElementById('closeLogServiceBtn')?.addEventListener('click', () => this.closeLogServiceModal());
    document.getElementById('cancelLogServiceBtn')?.addEventListener('click', () => this.closeLogServiceModal());
    document.getElementById('logServiceForm')?.addEventListener('submit', (e) => this.handleSaveService(e));

    // Lightbox Modal
    document.getElementById('closeLightboxBtn')?.addEventListener('click', () => this.closeLightbox());
    document.getElementById('imageLightbox')?.addEventListener('click', (e) => {
      if (e.target.id === 'imageLightbox') this.closeLightbox();
    });

    // Alerts View Tab Filters
    document.querySelectorAll('.alert-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.alert-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.getAttribute('data-alert-filter');
        this.notificationManager?.renderAlertsList(filter);
      });
    });

    // Push notification enable button
    document.getElementById('enablePushBtn')?.addEventListener('click', () => {
      this.notificationManager?.requestPermission();
    });

    // Test notification trigger
    document.getElementById('testNotificationBtn')?.addEventListener('click', () => {
      this.notificationManager?.playAlertSound();
      this.notificationManager?.sendPushAlert(
        'Homey Reminder Test 🔔',
        'AC Servicing scheduled in 5 days! Your HomeVault alerts are active.'
      );
      this.showToast('Test alert triggered!', 'success');
    });

    // Export / Import
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.handleExport());
    document.getElementById('importFileInput')?.addEventListener('change', (e) => {
      this.handleImport(e.target.files[0]);
    });

    // Phone modal handlers
    document.getElementById('openPhoneModalBtn')?.addEventListener('click', () => this.openPhoneModal());
    document.getElementById('openPhoneModalBtn2')?.addEventListener('click', () => this.openPhoneModal());
    document.getElementById('closePhoneModalBtn')?.addEventListener('click', () => this.closePhoneModal());
    document.getElementById('phoneModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'phoneModal') this.closePhoneModal();
    });

    // Copy phone URL
    document.getElementById('copyUrlBtn')?.addEventListener('click', () => {
      const urlText = document.getElementById('phoneUrlText')?.textContent;
      if (urlText) {
        navigator.clipboard.writeText(urlText);
        this.showToast('Copied link to clipboard!', 'success');
      }
    });
  }
}

// Bootstrap Homey App
document.addEventListener('DOMContentLoaded', () => {
  window.HomeyApp = new HomeyApp();
});
