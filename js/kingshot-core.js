/**
 * Kingshot Vikings Event - Core Library
 * Shared functionality for all alliances
 */

// Constants
const CONSTANTS = {
    DEFAULT_TIME_SLOTS: ['at all times', 'offline'],
    GROUP_TIME_THRESHOLD: 10000, // 10 seconds in milliseconds
    MAX_MARCH_LIMIT: 6,
    MIN_MARCH_LIMIT: 1,
    NOTIFICATION_DURATION: 4000,
    DEFAULT_ALLIANCE: 'COB',
    DEFAULT_EMOJI: '🔥',
    DEFAULT_COLORS: {
        primary: 'linear-gradient(90deg, #FF6B6B, #FF8E53)',
        badge: 'linear-gradient(45deg, #FF6B6B, #FF8E53)',
        group: 'linear-gradient(90deg, #FF6B6B, #FF8E53)'
    }
};

// CSS Classes
const CSS_CLASSES = {
    DRAGGING: 'dragging',
    ADMIN: 'admin',
    OFFLINE_GROUP: 'offline-group',
    SEARCH_MATCH: 'search-match',
    HAS_SEARCH_MATCH: 'has-search-match',
    SHOW: 'show'
};

class KingshotCore {
    constructor(config) {
        this.config = this._initializeConfig(config);
        this._initializeState();
        this._initializeFirebase();
        this._setupEventListeners();
        this._applyAllianceStyles();
    }

    _initializeConfig(config) {
        return {
            allianceName: config.allianceName || CONSTANTS.DEFAULT_ALLIANCE,
            colors: config.colors || CONSTANTS.DEFAULT_COLORS,
            emoji: config.emoji || CONSTANTS.DEFAULT_EMOJI,
            firebaseConfig: config.firebaseConfig,
            ...config
        };
    }

    _initializeState() {
        // Firebase variables
        this.database = null;
        this.auth = null;
        this.isConnected = false;
        this.playersRef = null;
        this.connectionRef = null;

        // State variables
        this.localPlayers = {};
        this.allPlayersData = {}; // Store all player data including deleted ones
        this.groups = [];
        this.timeSlots = [];
        this.isAdmin = false;
        this.currentPlayerName = '';
        this.currentAdminUser = null;
        this.currentSearchTerm = '';
    }

    // Apply alliance-specific styles
    _applyAllianceStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .header::before { 
                background: ${this.config.colors.primary}; 
            }
            .alliance-badge { 
                background: ${this.config.colors.badge}; 
            }
            .group::before { 
                background: ${this.config.colors.group}; 
            }
            
            /* Admin-mixed groups styling - REMOVED */
            
            /* Enhanced player drag feedback */
            .player-item.dragging {
                opacity: 0.5;
                transform: rotate(2deg);
            }
            
            .player-item:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: translateX(5px);
                cursor: ${this.isAdmin ? 'grab' : 'default'};
            }
            
            .player-item[draggable="true"]:active {
                cursor: grabbing;
            }
            
            /* Group rename button styles */
            .rename-btn:hover,
            .reset-name-btn:hover {
                opacity: 1 !important;
                transform: scale(1.1);
            }
            
            .group-title-row {
                position: relative;
            }
            
            @media (max-width: 768px) {
                .admin-drop-zone {
                    padding: 30px 20px;
                    min-height: 100px;
                }
            }
        `;
        document.head.appendChild(style);

        // Update UI elements
        const badge = document.querySelector('.alliance-badge');
        if (badge) {
            badge.textContent = `${this.config.emoji} ${this.config.allianceName} Alliance`;
        }

        const joinBtn = document.getElementById('addBtn');
        if (joinBtn) {
            joinBtn.textContent = `${this.config.emoji} Join ${this.config.allianceName}`;
        }

        const searchTitle = document.querySelector('.search-section h3');
        if (searchTitle) {
            searchTitle.textContent = `🔍 Find Your ${this.config.allianceName} Group`;
        }
    }

    // Firebase initialization
    async _initializeFirebase() {
        try {
            console.log(`Initializing Firebase for ${this.config.allianceName}...`);
            firebase.initializeApp(this.config.firebaseConfig);
            this.database = firebase.database();
            this.auth = firebase.auth();
            
            console.log('Firebase initialized successfully');
            
            // Set up authentication state listener
            this.auth.onAuthStateChanged((user) => {
                if (user) {
                    this.currentAdminUser = user;
                    this.isAdmin = true;
                    this.showAdminMode();
                } else {
                    this.currentAdminUser = null;
                    this.isAdmin = false;
                    this.hideAdminMode();
                }
                this.reorganizeGroups();
            });

            // Set up connection monitoring
            this.connectionRef = this.database.ref('.info/connected');
            this.connectionRef.on('value', (snapshot) => {
                this.isConnected = snapshot.val() === true;
                this.updateConnectionStatus();
            });

            // Set up players reference for this alliance only
            this.playersRef = this.database.ref(`event/alliances/${this.config.allianceName}/players`);
            this.timeSlotsRef = this.database.ref(`event/alliances/${this.config.allianceName}/timeSlots`);
            console.log(`${this.config.allianceName} playersRef and timeSlotsRef initialized`);
            
            // Listen for player changes
            this.playersRef.on('value', (snapshot) => {
                const data = snapshot.val();
                // Store all data (including deleted players) for recovery purposes
                this.allPlayersData = data || {};
                
                // Filter out deleted players for normal display
                this.localPlayers = {};
                if (data) {
                    Object.entries(data).forEach(([playerName, playerData]) => {
                        if (!playerData.deleted) {
                            this.localPlayers[playerName] = playerData;
                        }
                    });
                }
                
                this.reorganizeGroups();
                this.updateOnlineCount();
            });

            // Listen for time slots changes - UPDATED: Include offline as default
            this.timeSlotsRef.on('value', (snapshot) => {
                const data = snapshot.val();
                // Default time slots now include offline as a standard option
                this.timeSlots = data ? Object.values(data) : [...CONSTANTS.DEFAULT_TIME_SLOTS];
                // Use setTimeout to ensure DOM is ready
                setTimeout(() => {
                    this.updateTimeSlotDropdown();
                }, 100);
            });

            // Enable inputs when connected
            this.enableInterface();
            
            if (this.isAdmin) {
                this.showNotification(`Connected to ${this.config.allianceName} Firebase!`, 'success');
            }

        } catch (error) {
            console.error('Firebase initialization error:', error);
            if (this.isAdmin) {
                this.showNotification('Firebase connection failed. Check console for details.', 'error');
            }
            this.updateConnectionStatus(false, error.message);
            
            setTimeout(() => {
                this.showFallbackMode();
            }, 2000);
        }
    }

    // Time Slot Management
    updateTimeSlotDropdown() {
        const timeSelect = document.getElementById('timeSelect');
        if (!timeSelect) return;
        
        // Clear existing options
        timeSelect.innerHTML = '';
        
        // Add time slots (including offline as a standard time slot)
        this.timeSlots.forEach(timeSlot => {
            const option = document.createElement('option');
            option.value = timeSlot;
            option.textContent = timeSlot;
            if (timeSlot === 'at all times') {
                option.selected = true;
            }
            timeSelect.appendChild(option);
        });
    }

    showTimeSlotManager() {
        if (!this.isAdmin) {
            this.showNotification('Admin access required!', 'error');
            return;
        }
        
        this.createTimeSlotModal();
    }

    createTimeSlotModal() {
        // Remove existing modal if present
        const existingModal = document.getElementById('timeSlotModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal HTML
        const modalHTML = `
            <div id="timeSlotModal" class="time-slot-modal">
                <div class="time-slot-modal-content">
                    <div class="time-slot-modal-header">
                        <h2>🕒 Manage Time Slots</h2>
                        <button class="close-btn" onclick="closeTimeSlotModal()">×</button>
                    </div>
                    
                    <div class="time-slot-form">
                        <h3>Add New Time Slot</h3>
                        <div class="time-input-group">
                            <input type="text" id="newTimeSlot" placeholder="e.g., 20:00 UTC, Morning, Evening..." maxlength="50">
                            <button onclick="kingshot.addTimeSlot()" class="add-time-btn">➕ Add</button>
                        </div>
                    </div>
                    
                    <div class="current-time-slots">
                        <h3>Current Time Slots</h3>
                        <div id="timeSlotsList" class="time-slots-list">
                            ${this.renderTimeSlotsList()}
                        </div>
                    </div>
                    
                    <div class="time-slot-actions">
                        <button onclick="kingshot.resetToDefaultTimeSlots()" class="reset-btn">🔄 Reset to Default</button>
                        <button onclick="closeTimeSlotModal()" class="close-modal-btn">Close</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add modal styles
        this.addTimeSlotModalStyles();
        
        // Show modal
        document.getElementById('timeSlotModal').style.display = 'flex';
        
        // Focus on input
        document.getElementById('newTimeSlot').focus();
        
        // Add enter key listener
        document.getElementById('newTimeSlot').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addTimeSlot();
            }
        });
    }

    renderTimeSlotsList() {
        return this.timeSlots.map(timeSlot => `
            <div class="time-slot-item">
                <span class="time-slot-text">${timeSlot}</span>
                <div class="time-slot-controls">
                    <button onclick="kingshot.editTimeSlot('${timeSlot}')" class="edit-time-btn" title="Edit">✏️</button>
                    ${timeSlot !== 'at all times' ? `<button onclick="kingshot.deleteTimeSlot('${timeSlot}')" class="delete-time-btn" title="Delete">🗑️</button>` : ''}
                </div>
            </div>
        `).join('');
    }

    async addTimeSlot() {
        const input = document.getElementById('newTimeSlot');
        const newTimeSlot = input.value.trim();
        
        if (!newTimeSlot) {
            this.showNotification('Please enter a time slot!', 'error');
            return;
        }
        
        if (this.timeSlots.includes(newTimeSlot)) {
            this.showNotification('This time slot already exists!', 'error');
            return;
        }
        
        try {
            // Add to current time slots
            const updatedTimeSlots = [...this.timeSlots, newTimeSlot];
            
            if (this.isConnected && this.timeSlotsRef) {
                // Save to Firebase
                const timeSlotData = {};
                updatedTimeSlots.forEach((slot, index) => {
                    timeSlotData[`slot_${index}`] = slot;
                });
                
                await this.timeSlotsRef.set(timeSlotData);
            } else {
                // Update locally
                this.timeSlots = updatedTimeSlots;
                this.updateTimeSlotDropdown();
            }
            
            // Clear input and refresh list
            input.value = '';
            this.refreshTimeSlotsList();
            
            this.showNotification(`Time slot "${newTimeSlot}" added successfully!`, 'success');
            
        } catch (error) {
            console.error('Error adding time slot:', error);
            this.showNotification('Failed to add time slot!', 'error');
        }
    }

    async editTimeSlot(oldTimeSlot) {
        const newTimeSlot = prompt(`Edit time slot:`, oldTimeSlot);
        
        if (!newTimeSlot || newTimeSlot.trim() === '' || newTimeSlot.trim() === oldTimeSlot) {
            return;
        }
        
        const trimmedNew = newTimeSlot.trim();
        
        if (this.timeSlots.includes(trimmedNew)) {
            this.showNotification('This time slot already exists!', 'error');
            return;
        }
        
        try {
            // Update time slots array
            const updatedTimeSlots = this.timeSlots.map(slot => 
                slot === oldTimeSlot ? trimmedNew : slot
            );
            
            if (this.isConnected && this.timeSlotsRef) {
                // Save to Firebase
                const timeSlotData = {};
                updatedTimeSlots.forEach((slot, index) => {
                    timeSlotData[`slot_${index}`] = slot;
                });
                
                await this.timeSlotsRef.set(timeSlotData);
                
                // Update all players who had the old time slot
                const playersToUpdate = {};
                Object.entries(this.localPlayers).forEach(([playerName, playerData]) => {
                    if (playerData.timeSlot === oldTimeSlot) {
                        playersToUpdate[`${playerName}/timeSlot`] = trimmedNew;
                    }
                });
                
                if (Object.keys(playersToUpdate).length > 0) {
                    await this.playersRef.update(playersToUpdate);
                }
            } else {
                // Update locally
                this.timeSlots = updatedTimeSlots;
                
                // Update local players
                Object.keys(this.localPlayers).forEach(playerName => {
                    if (this.localPlayers[playerName].timeSlot === oldTimeSlot) {
                        this.localPlayers[playerName].timeSlot = trimmedNew;
                    }
                });
                
                this.updateTimeSlotDropdown();
                this.reorganizeGroups();
            }
            
            this.refreshTimeSlotsList();
            this.showNotification(`Time slot updated to "${trimmedNew}"!`, 'success');
            
        } catch (error) {
            console.error('Error editing time slot:', error);
            this.showNotification('Failed to edit time slot!', 'error');
        }
    }

    async deleteTimeSlot(timeSlot) {
        if (timeSlot === 'at all times') {
            this.showNotification('Cannot delete default time slot!', 'error');
            return;
        }
        
        // Check if any players are using this time slot
        const playersUsingSlot = Object.entries(this.localPlayers).filter(
            ([_, playerData]) => playerData.timeSlot === timeSlot
        );
        
        if (playersUsingSlot.length > 0) {
            const confirm = window.confirm(
                `${playersUsingSlot.length} player(s) are using this time slot. ` +
                `They will be moved to "at all times". Continue?`
            );
            if (!confirm) return;
        }
        
        try {
            // Remove from time slots array
            const updatedTimeSlots = this.timeSlots.filter(slot => slot !== timeSlot);
            
            if (this.isConnected && this.timeSlotsRef) {
                // Save to Firebase
                const timeSlotData = {};
                updatedTimeSlots.forEach((slot, index) => {
                    timeSlotData[`slot_${index}`] = slot;
                });
                
                await this.timeSlotsRef.set(timeSlotData);
                
                // Update affected players
                if (playersUsingSlot.length > 0) {
                    const playersToUpdate = {};
                    playersUsingSlot.forEach(([playerName]) => {
                        playersToUpdate[`${playerName}/timeSlot`] = 'at all times';
                    });
                    await this.playersRef.update(playersToUpdate);
                }
            } else {
                // Update locally
                this.timeSlots = updatedTimeSlots;
                
                // Update affected players locally
                playersUsingSlot.forEach(([playerName]) => {
                    this.localPlayers[playerName].timeSlot = 'at all times';
                });
                
                this.updateTimeSlotDropdown();
                this.reorganizeGroups();
            }
            
            this.refreshTimeSlotsList();
            this.showNotification(`Time slot "${timeSlot}" deleted!`, 'info');
            
        } catch (error) {
            console.error('Error deleting time slot:', error);
            this.showNotification('Failed to delete time slot!', 'error');
        }
    }

    async resetToDefaultTimeSlots() {
        if (!confirm('Reset all time slots to default? This will affect all players!')) {
            return;
        }
        
        try {
            const defaultTimeSlots = [...CONSTANTS.DEFAULT_TIME_SLOTS];
            
            if (this.isConnected && this.timeSlotsRef) {
                await this._resetTimeSlotsInFirebase(defaultTimeSlots);
            } else {
                await this._resetTimeSlotsLocally(defaultTimeSlots);
            }
            
            this.refreshTimeSlotsList();
            this.showNotification('Time slots reset to default (including offline)!', 'info');
            
        } catch (error) {
            console.error('Error resetting time slots:', error);
            this.showNotification('Failed to reset time slots!', 'error');
        }
    }

    async _resetTimeSlotsInFirebase(defaultTimeSlots) {
        const timeSlotData = {};
        defaultTimeSlots.forEach((slot, index) => {
            timeSlotData[`slot_${index}`] = slot;
        });
        
        await this.timeSlotsRef.set(timeSlotData);
        
        const playersToUpdate = this._getPlayersToUpdateForDefaultTimeSlots();
        if (Object.keys(playersToUpdate).length > 0) {
            await this.playersRef.update(playersToUpdate);
        }
    }

    async _resetTimeSlotsLocally(defaultTimeSlots) {
        this.timeSlots = defaultTimeSlots;
        
        Object.keys(this.localPlayers).forEach(playerName => {
            const currentTimeSlot = this.localPlayers[playerName].timeSlot;
            if (!CONSTANTS.DEFAULT_TIME_SLOTS.includes(currentTimeSlot)) {
                this.localPlayers[playerName].timeSlot = 'at all times';
            }
        });
        
        this.updateTimeSlotDropdown();
        this.reorganizeGroups();
    }

    _getPlayersToUpdateForDefaultTimeSlots() {
        const playersToUpdate = {};
        Object.keys(this.localPlayers).forEach(playerName => {
            const currentTimeSlot = this.localPlayers[playerName].timeSlot;
            if (!CONSTANTS.DEFAULT_TIME_SLOTS.includes(currentTimeSlot)) {
                playersToUpdate[`${playerName}/timeSlot`] = 'at all times';
            }
        });
        return playersToUpdate;
    }

    refreshTimeSlotsList() {
        const listContainer = document.getElementById('timeSlotsList');
        if (listContainer) {
            listContainer.innerHTML = this.renderTimeSlotsList();
        }
    }

    closeTimeSlotModal() {
        const modal = document.getElementById('timeSlotModal');
        if (modal) {
            modal.style.display = 'none';
            modal.remove();
        }
    }

    addTimeSlotModalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .time-slot-modal {
                display: none;
                position: fixed;
                z-index: 2000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                align-items: center;
                justify-content: center;
            }
            
            .time-slot-modal-content {
                backdrop-filter: blur(20px);
                background: rgba(255, 255, 255, 0.95);
                border-radius: 20px;
                padding: 30px;
                max-width: 600px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                color: #333;
            }
            
            .time-slot-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 25px;
                border-bottom: 2px solid #eee;
                padding-bottom: 15px;
            }
            
            .time-slot-modal-header h2 {
                margin: 0;
                color: #333;
                font-size: 1.5rem;
            }
            
            .close-btn {
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: #666;
                padding: 5px;
                border-radius: 50%;
                transition: all 0.3s ease;
            }
            
            .close-btn:hover {
                background: rgba(0, 0, 0, 0.1);
                color: #333;
            }
            
            .time-slot-form {
                margin-bottom: 30px;
                padding: 20px;
                background: rgba(33, 150, 243, 0.1);
                border-radius: 15px;
                border: 2px solid rgba(33, 150, 243, 0.2);
            }
            
            .time-slot-form h3 {
                margin: 0 0 15px 0;
                color: #333;
                font-size: 1.2rem;
            }
            
            .time-input-group {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            
            .time-input-group input {
                flex: 1;
                padding: 12px 15px;
                border: 2px solid #ddd;
                border-radius: 10px;
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            
            .time-input-group input:focus {
                outline: none;
                border-color: #2196F3;
                box-shadow: 0 0 10px rgba(33, 150, 243, 0.3);
            }
            
            .add-time-btn {
                padding: 12px 20px;
                background: linear-gradient(45deg, #4CAF50, #45a049);
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.3s ease;
                white-space: nowrap;
            }
            
            .add-time-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(76, 175, 80, 0.4);
            }
            
            .current-time-slots {
                margin-bottom: 25px;
            }
            
            .current-time-slots h3 {
                margin: 0 0 15px 0;
                color: #333;
                font-size: 1.2rem;
            }
            
            .time-slots-list {
                max-height: 200px;
                overflow-y: auto;
                border: 2px solid #eee;
                border-radius: 10px;
                padding: 10px;
                background: rgba(255, 255, 255, 0.5);
            }
            
            .time-slot-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                margin: 5px 0;
                background: rgba(255, 255, 255, 0.7);
                border-radius: 8px;
                border: 1px solid rgba(0, 0, 0, 0.1);
                transition: all 0.3s ease;
            }
            
            .time-slot-item:hover {
                background: rgba(255, 255, 255, 0.9);
                transform: translateX(5px);
            }
            
            .time-slot-text {
                font-weight: 500;
                color: #333;
            }
            
            .time-slot-controls {
                display: flex;
                gap: 5px;
            }
            
            .edit-time-btn,
            .delete-time-btn {
                background: none;
                border: none;
                padding: 5px 8px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: all 0.3s ease;
            }
            
            .edit-time-btn {
                background: linear-gradient(45deg, #2196F3, #1976D2);
                color: white;
            }
            
            .edit-time-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 8px rgba(33, 150, 243, 0.4);
            }
            
            .delete-time-btn {
                background: linear-gradient(45deg, #f44336, #d32f2f);
                color: white;
            }
            
            .delete-time-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 8px rgba(244, 67, 54, 0.4);
            }
            
            .time-slot-actions {
                display: flex;
                gap: 15px;
                justify-content: flex-end;
                border-top: 2px solid #eee;
                padding-top: 20px;
            }
            
            .reset-btn,
            .close-modal-btn {
                padding: 12px 25px;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-size: 1rem;
                font-weight: bold;
                transition: all 0.3s ease;
            }
            
            .reset-btn {
                background: linear-gradient(45deg, #FF9800, #F57C00);
                color: white;
            }
            
            .reset-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(255, 152, 0, 0.4);
            }
            
            .close-modal-btn {
                background: linear-gradient(45deg, #666, #555);
                color: white;
            }
            
            .close-modal-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(102, 102, 102, 0.4);
            }
            
            @media (max-width: 768px) {
                .time-slot-modal-content {
                    width: 95%;
                    padding: 20px;
                }
                
                .time-input-group {
                    flex-direction: column;
                }
                
                .time-input-group input {
                    width: 100%;
                }
                
                .time-slot-actions {
                    flex-direction: column;
                }
                
                .time-slot-item {
                    flex-direction: column;
                    gap: 10px;
                    text-align: center;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Search functionality
    searchPlayer() {
        const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
        this.currentSearchTerm = searchTerm;
        
        const clearBtn = document.getElementById('clearSearchBtn');
        
        if (searchTerm === '') {
            clearBtn.style.display = 'none';
        } else {
            clearBtn.style.display = 'block';
        }
        
        this.updateDisplay();
        
        // Scroll to first matching group after a short delay to ensure DOM is updated
        if (searchTerm) {
            setTimeout(() => {
                const matchingGroup = document.querySelector('.group.has-search-match');
                if (matchingGroup) {
                    matchingGroup.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }
            }, 100);
        }
    }

    clearSearch() {
        document.getElementById('searchInput').value = '';
        this.currentSearchTerm = '';
        document.getElementById('clearSearchBtn').style.display = 'none';
        this.updateDisplay();
    }

    // Player management
    async addPlayer() {
        const input = document.getElementById('playerInput');
        const marchSelect = document.getElementById('marchSelect');
        const timeSelect = document.getElementById('timeSelect');
        const playerName = input.value.trim();
        const marchValue = marchSelect.value;
        const timeValue = timeSelect.value;
        
        if (playerName === '') {
            this.showNotification('Please enter a player name!', 'error');
            return;
        }
        
        if (this.localPlayers[playerName]) {
            this.showNotification(`This player is already registered in ${this.config.allianceName}!`, 'error');
            return;
        }

        // Find existing players with same tags to join their group
        let targetTimestamp = Date.now();
        
        // Look for existing players with same marchLimit and timeSlot
        const existingPlayersWithSameTags = Object.entries(this.localPlayers).filter(([_, playerData]) => {
            const originalMarchLimit = playerData.marchLimit.toString().split('_newgroup_')[0];
            return originalMarchLimit === marchValue && playerData.timeSlot === timeValue;
        });

        // Also check admin-override groups that still have space
        const adminGroupsWithSpace = {};
        Object.entries(this.localPlayers).forEach(([playerName, playerData]) => {
            const originalMarchLimit = playerData.marchLimit.toString().split('_newgroup_')[0];
            if (playerData.adminGroupOverride && 
                originalMarchLimit === marchValue && 
                playerData.timeSlot === timeValue) {
                
                if (!adminGroupsWithSpace[playerData.adminGroupOverride]) {
                    adminGroupsWithSpace[playerData.adminGroupOverride] = [];
                }
                adminGroupsWithSpace[playerData.adminGroupOverride].push(playerData);
            }
        });

        // Check if any admin group has space
        for (const [adminGroupId, groupPlayers] of Object.entries(adminGroupsWithSpace)) {
            if (groupPlayers.length < parseInt(marchValue) + 1) {
                // Join this admin group
                targetTimestamp = groupPlayers[0].timestamp + Math.random() * 1000;
                console.log(`📥 New player ${playerName} joining admin group ${adminGroupId} with ${groupPlayers.length} players`);
                
                // Set the same admin override to join the group
                const playerData = {
                    marchLimit: marchValue,
                    timeSlot: timeValue,
                    timestamp: targetTimestamp,
                    adminGroupOverride: adminGroupId
                };
                
                try {
                    if (this.isConnected && this.playersRef) {
                        await this.playersRef.child(playerName).set(playerData);
                        this.currentPlayerName = playerName;
                        this.showNotification(`${playerName} joined existing ${this.config.allianceName} group!`, 'success');
                    } else {
                        this.localPlayers[playerName] = playerData;
                        this.currentPlayerName = playerName;
                        this.reorganizeGroups();
                        this.showNotification(`${playerName} joined existing ${this.config.allianceName} group!`, 'success');
                    }
                    
                    input.value = '';
                    input.focus();
                    return; // Exit early - player was added to admin group
                    
                } catch (error) {
                    console.error('Error adding player to admin group:', error);
                    // Continue with normal logic if admin group join fails
                }
            }
        }
        
        if (existingPlayersWithSameTags.length > 0) {
            // Find the OLDEST group that isn't full yet (prioritize earlier groups)
            const sortedPlayers = existingPlayersWithSameTags.sort(([_, a], [__, b]) => a.timestamp - b.timestamp);
            
            for (const [_, existingPlayerData] of sortedPlayers) {
                // Check if this player's group has space
                const playersInSameGroup = Object.entries(this.localPlayers).filter(([__, playerData]) => {
                    const originalMarchLimit = playerData.marchLimit.toString().split('_newgroup_')[0];
                    const timeDiff = Math.abs(playerData.timestamp - existingPlayerData.timestamp);
                    return originalMarchLimit === marchValue && 
                           playerData.timeSlot === timeValue && 
                           timeDiff < 10000; // Same group threshold (10 seconds)
                });
                
                if (playersInSameGroup.length < parseInt(marchValue)) {
                    // Join this group by using similar timestamp (within the 10-second window)
                    targetTimestamp = existingPlayerData.timestamp + Math.random() * 1000; // Small random offset to maintain order
                    console.log(`📥 New player ${playerName} joining existing group with timestamp ${targetTimestamp}`);
                    break;
                }
            }
        }
    
        try {
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).set({
                    marchLimit: marchValue,
                    timeSlot: timeValue,
                    timestamp: targetTimestamp
                });
                this.currentPlayerName = playerName;
                
                // Better messaging for offline players
                const displayText = `${marchValue} marches`;
                const timeText = timeValue === 'offline' ? 'offline' : `at ${timeValue}`;
                this.showNotification(`${playerName} joined ${this.config.allianceName} with ${displayText} ${timeText}!`, 'success');
            } else {
                // Fallback to local mode
                const playerData = {
                    marchLimit: marchValue,
                    timeSlot: timeValue,
                    timestamp: targetTimestamp
                };
                this.localPlayers[playerName] = playerData;
                this.allPlayersData[playerName] = playerData; // Keep in sync
                this.currentPlayerName = playerName;
                this.reorganizeGroups();
                
                const displayText = `${marchValue} marches`;
                const timeText = timeValue === 'offline' ? 'offline' : `at ${timeValue}`;
                if (this.isAdmin) {
                    this.showNotification(`${playerName} added locally to ${this.config.allianceName}`, 'info');
                } else {
                    this.showNotification(`${playerName} joined ${this.config.allianceName} with ${displayText} ${timeText}!`, 'success');
                }
            }
            
            input.value = '';
            input.focus();
            
        } catch (error) {
            console.error('Error adding player:', error);
            this.showNotification('Failed to add player. Please try again.', 'error');
        }
    }

    async removePlayer(playerName) {
        try {
            if (this.isConnected && this.playersRef) {
                // Soft delete: mark as deleted instead of removing
                await this.playersRef.child(playerName).update({
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedBy: this.isAdmin ? 'admin' : 'user'
                });
                
                if (playerName === this.currentPlayerName) {
                    this.currentPlayerName = '';
                }
                
                this.showNotification(`${playerName} left ${this.config.allianceName}`, 'info');
            } else {
                // Fallback to local mode - soft delete
                if (this.localPlayers[playerName]) {
                    // Mark as deleted in allPlayersData
                    if (!this.allPlayersData[playerName]) {
                        this.allPlayersData[playerName] = this.localPlayers[playerName];
                    }
                    this.allPlayersData[playerName].deleted = true;
                    this.allPlayersData[playerName].deletedAt = Date.now();
                    this.allPlayersData[playerName].deletedBy = this.isAdmin ? 'admin' : 'user';
                    
                    // Remove from display data
                    delete this.localPlayers[playerName];
                }
                
                if (playerName === this.currentPlayerName) {
                    this.currentPlayerName = '';
                }
                
                this.reorganizeGroups();
                
                if (this.isAdmin) {
                    this.showNotification(`${playerName} removed from ${this.config.allianceName}`, 'info');
                } else {
                    this.showNotification(`${playerName} left ${this.config.allianceName}`, 'info');
                }
            }
        } catch (error) {
            console.error('Error removing player:', error);
            this.showNotification('Failed to remove player. Please try again.', 'error');
        }
    }

    async clearAllPlayers() {
        if (Object.keys(this.localPlayers).length === 0) {
            this.showNotification(`No ${this.config.allianceName} players to clear!`, 'error');
            return;
        }

        if (!this.isAdmin) {
            this.showNotification('Admin access required!', 'error');
            return;
        }

        if (!confirm(`Are you sure you want to remove ALL players from ${this.config.allianceName} alliance?`)) {
            return;
        }

        try {
            if (this.isConnected && this.playersRef) {
                await this.playersRef.remove();
                this.currentPlayerName = '';
                this.showNotification(`All ${this.config.allianceName} players removed`, 'info');
            } else {
                this.localPlayers = {};
                this.allPlayersData = {}; // Also clear recovery data
                this.currentPlayerName = '';
                this.reorganizeGroups();
                
                if (this.isAdmin) {
                    this.showNotification(`All ${this.config.allianceName} players removed locally`, 'info');
                } else {
                    this.showNotification(`All ${this.config.allianceName} players removed`, 'info');
                }
            }
        } catch (error) {
            console.error('Error clearing players:', error);
            this.showNotification('Failed to clear players. Please try again.', 'error');
        }
    }

    // Group organization
    reorganizeGroups() {
        this.groups = [];
        
        // Create an array of all players with their info
        const allPlayers = [];
        
        Object.entries(this.localPlayers).forEach(([playerName, playerData]) => {
            // Skip deleted players
            if (playerData.deleted) return;
            // Use original tags always (no modifications)
            const marchLimit = playerData.marchLimit.toString().split('_newgroup_')[0]; // Clean legacy data
            const timeSlot = playerData.timeSlot || 'at all times';
            const timestamp = playerData.timestamp || 0;
            const adminOverride = playerData.adminGroupOverride || null;
            
            allPlayers.push({
                name: playerName,
                marchLimit: marchLimit,
                timeSlot: timeSlot,
                timestamp: timestamp,
                adminOverride: adminOverride,
                originalData: playerData
            });
        });
        
        // Sort players by timestamp (first come, first served)
        allPlayers.sort((a, b) => a.timestamp - b.timestamp);
        
        const processedPlayers = new Set();
        
        // First, handle admin-grouped players (players with same adminGroupOverride)
        const adminGroups = {};
        allPlayers.forEach(player => {
            if (player.adminOverride && !processedPlayers.has(player.name)) {
                if (!adminGroups[player.adminOverride]) {
                    adminGroups[player.adminOverride] = [];
                }
                adminGroups[player.adminOverride].push(player);
                processedPlayers.add(player.name);
            }
        });
        
        // Create groups for admin-overridden players
        Object.values(adminGroups).forEach(groupPlayers => {
            if (groupPlayers.length === 0) return;
            
            // Sort by timestamp within admin group
            groupPlayers.sort((a, b) => a.timestamp - b.timestamp);
            
            const groupSize = parseInt(groupPlayers[0].marchLimit) + 1;
            
            // Check if any player has a custom group name
            let customGroupName = null;
            for (const player of groupPlayers) {
                const playerData = this.localPlayers[player.name];
                if (playerData && playerData.customGroupName) {
                    customGroupName = playerData.customGroupName;
                    break;
                }
            }
            
            this.groups.push({
                players: groupPlayers,
                marchLimit: groupPlayers[0].marchLimit,
                timeSlot: groupPlayers[0].timeSlot,
                displayMarchLimit: groupPlayers[0].marchLimit,
                groupNumber: this.groups.length + 1,
                maxSize: groupSize,
                isFull: groupPlayers.length >= groupSize,
                isOffline: groupPlayers[0].timeSlot === 'offline',
                isCustom: false,
                groupType: 'normal',
                customName: customGroupName
            });
        });
        
        // Then handle regular players (group by tags + timestamp proximity)
        allPlayers.forEach(player => {
            if (processedPlayers.has(player.name)) return;
            
            const groupSize = parseInt(player.marchLimit) + 1;
            
            // Find other players with same tags
            const candidatePlayers = allPlayers.filter(otherPlayer => {
                if (processedPlayers.has(otherPlayer.name)) return false;
                if (otherPlayer.adminOverride) return false; // Skip admin-overridden players
                if (otherPlayer.marchLimit !== player.marchLimit) return false;
                if (otherPlayer.timeSlot !== player.timeSlot) return false;
                return true;
            });
            
            // Sort candidates by timestamp
            candidatePlayers.sort((a, b) => a.timestamp - b.timestamp);
            
            // Group by timestamp proximity - players within 10 seconds belong together
            const groupPlayers = [];
            let currentGroupTimestamp = player.timestamp;
            
            for (const candidate of candidatePlayers) {
                const timeDiff = Math.abs(candidate.timestamp - currentGroupTimestamp);
                
                // If timestamp is close to current group's range, add to group
                if (timeDiff < 10000 && groupPlayers.length < groupSize) {
                    groupPlayers.push(candidate);
                    processedPlayers.add(candidate.name);
                    
                    // Update group timestamp range
                    if (candidate.timestamp > currentGroupTimestamp) {
                        currentGroupTimestamp = candidate.timestamp;
                    }
                }
            }
            
            // If no players were added to group, add the original player
            if (groupPlayers.length === 0) {
                groupPlayers.push(player);
                processedPlayers.add(player.name);
            }
            
            // Check if any player in this group has a custom group name
            let customGroupName = null;
            for (const groupPlayer of groupPlayers) {
                const playerData = this.localPlayers[groupPlayer.name];
                if (playerData && playerData.customGroupName) {
                    customGroupName = playerData.customGroupName;
                    break;
                }
            }
            
            // Create the group
            this.groups.push({
                players: groupPlayers,
                marchLimit: player.marchLimit,
                timeSlot: player.timeSlot,
                displayMarchLimit: player.marchLimit,
                groupNumber: this.groups.length + 1,
                maxSize: groupSize,
                isFull: groupPlayers.length >= groupSize,
                isOffline: player.timeSlot === 'offline',
                isCustom: false,
                groupType: 'normal',
                customName: customGroupName
            });
        });
        
        this.updateDisplay();
    }

    // Admin functionality
    async adminLogin() {
        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value;
        
        if (!email || !password) {
            this.showAuthError('Please enter both email and password');
            return;
        }

        try {
            document.getElementById('adminLoginBtn').disabled = true;
            this.clearAuthError();
            
            // Sign in with Firebase Auth
            await this.auth.signInWithEmailAndPassword(email, password);
            
            // Clear form
            document.getElementById('adminEmail').value = '';
            document.getElementById('adminPassword').value = '';
            document.getElementById('adminSection').classList.remove('show');
            
            this.showNotification('Admin access granted!', 'success');
            
        } catch (error) {
            console.error('Admin login error:', error);
            
            let errorMessage = 'Login failed. Please check your credentials.';
            
            switch (error.code) {
                case 'auth/user-not-found':
                    errorMessage = 'Admin account not found.';
                    break;
                case 'auth/wrong-password':
                    errorMessage = 'Incorrect password.';
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'Invalid email address.';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed attempts. Try again later.';
                    break;
            }
            
            this.showAuthError(errorMessage);
            this.showNotification('Admin login failed', 'error');
        } finally {
            document.getElementById('adminLoginBtn').disabled = false;
        }
    }

    async adminLogout() {
        try {
            await this.auth.signOut();
            this.showNotification('Admin logged out', 'info');
            document.getElementById('adminSection').classList.remove('show');
        } catch (error) {
            console.error('Logout error:', error);
            this.showNotification('Logout failed', 'error');
        }
    }

    toggleAdminSection() {
        const section = document.getElementById('adminSection');
        const isVisible = section.classList.contains('show');
        
        if (isVisible) {
            section.classList.remove('show');
            this.clearAuthError();
        } else {
            section.classList.add('show');
            if (!this.isAdmin) {
                document.getElementById('adminEmail').focus();
            }
        }
    }

    // Recovery functionality for deleted players
    async getDeletedPlayers() {
        const deletedPlayers = [];
        const sourceData = this.allPlayersData || this.localPlayers;
        Object.entries(sourceData).forEach(([playerName, playerData]) => {
            if (playerData.deleted) {
                deletedPlayers.push({
                    name: playerName,
                    data: playerData,
                    deletedAt: new Date(playerData.deletedAt).toLocaleString('de-DE'),
                    deletedBy: playerData.deletedBy || 'unknown'
                });
            }
        });
        return deletedPlayers.sort((a, b) => b.data.deletedAt - a.data.deletedAt);
    }

    async restorePlayer(playerName) {
        if (!this.isAdmin) {
            this.showNotification('Only admins can restore players', 'error');
            return;
        }

        try {
            if (this.isConnected && this.playersRef) {
                // Remove deletion markers from Firebase
                await this.playersRef.child(playerName).update({
                    deleted: null,
                    deletedAt: null,
                    deletedBy: null,
                    restoredAt: Date.now(),
                    restoredBy: 'admin'
                });
            } else {
                // Local restore - work with allPlayersData if available
                const sourceData = this.allPlayersData || this.localPlayers;
                if (sourceData[playerName]) {
                    delete sourceData[playerName].deleted;
                    delete sourceData[playerName].deletedAt;
                    delete sourceData[playerName].deletedBy;
                    sourceData[playerName].restoredAt = Date.now();
                    sourceData[playerName].restoredBy = 'admin';
                    
                    // Also restore to localPlayers for immediate display
                    this.localPlayers[playerName] = sourceData[playerName];
                }
            }
            
            this.reorganizeGroups();
            this.showNotification(`${playerName} restored successfully`, 'success');
        } catch (error) {
            console.error('Error restoring player:', error);
            this.showNotification('Failed to restore player', 'error');
        }
    }

    async permanentlyDeletePlayer(playerName) {
        if (!this.isAdmin) {
            this.showNotification('Only admins can permanently delete players', 'error');
            return;
        }

        if (!confirm(`Permanently delete ${playerName}? This cannot be undone!`)) {
            return;
        }

        try {
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).remove();
            } else {
                // Local permanent delete - work with allPlayersData if available
                const sourceData = this.allPlayersData || this.localPlayers;
                delete sourceData[playerName];
                delete this.localPlayers[playerName]; // Also remove from display data
            }
            
            this.showNotification(`${playerName} permanently deleted`, 'info');
        } catch (error) {
            console.error('Error permanently deleting player:', error);
            this.showNotification('Failed to permanently delete player', 'error');
        }
    }

    async showRecoveryModal() {
        if (!this.isAdmin) {
            this.showNotification('Only admins can access recovery', 'error');
            return;
        }

        const deletedPlayers = await this.getDeletedPlayers();
        
        if (deletedPlayers.length === 0) {
            this.showNotification('No deleted players to recover', 'info');
            return;
        }

        const modalHTML = `
            <div id="recoveryModal" class="recovery-modal">
                <div class="recovery-modal-content">
                    <div class="recovery-modal-header">
                        <h2>🔄 Player Recovery</h2>
                        <button class="close-btn" onclick="closeRecoveryModal()">×</button>
                    </div>
                    
                    <div class="recovery-info" style="text-align: center; margin-bottom: 20px; color: #666; font-size: 1.1em;">
                        ${deletedPlayers.length} deleted player${deletedPlayers.length > 1 ? 's' : ''} found
                    </div>
                    
                    <div class="deleted-players-section" style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
                        ${deletedPlayers.map(player => `
                            <div class="deleted-player-item" style="
                                background: linear-gradient(135deg, #fff5f5, #ffe5e5);
                                border: 1px solid #ffcccb;
                                border-left: 4px solid #f44336;
                                padding: 15px;
                                margin-bottom: 12px;
                                border-radius: 8px;
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                transition: all 0.3s ease;
                            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(244, 67, 54, 0.2)'"
                               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                                <div>
                                    <h4 style="margin: 0 0 5px 0; color: #333; font-size: 1.1em;">${player.name}</h4>
                                    <p style="margin: 0 0 3px 0; font-size: 0.9em; color: #666;">
                                        March Limit: <strong>${player.data.marchLimit}</strong> | 
                                        Time: <strong>${player.data.timeSlot || 'at all times'}</strong>
                                    </p>
                                    <p style="margin: 0; font-size: 0.8em; color: #999;">
                                        Deleted: ${player.deletedAt} by ${player.deletedBy}
                                    </p>
                                </div>
                                <div style="display: flex; gap: 8px; flex-shrink: 0;">
                                    <button onclick="kingshot.restorePlayer('${player.name}'); closeRecoveryModal();" 
                                        class="restore-btn" style="
                                            background: linear-gradient(45deg, #4CAF50, #45a049);
                                            color: white;
                                            border: none;
                                            padding: 8px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 0.9em;
                                            transition: all 0.3s ease;
                                        ">
                                        ✅ Restore
                                    </button>
                                    <button onclick="kingshot.permanentlyDeletePlayer('${player.name}'); this.closest('.deleted-player-item').remove();" 
                                        class="delete-btn" style="
                                            background: linear-gradient(45deg, #f44336, #d32f2f);
                                            color: white;
                                            border: none;
                                            padding: 8px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 0.9em;
                                            transition: all 0.3s ease;
                                        ">
                                        🗑️ Delete
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="recovery-actions" style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 2px solid #eee;">
                        <button onclick="if(confirm('This will permanently delete all players deleted over 30 days ago. Continue?')) { kingshot.cleanupOldDeletedPlayers(); }" 
                            class="cleanup-btn" style="
                                background: linear-gradient(45deg, #FF9800, #F57C00);
                                color: white;
                                border: none;
                                padding: 10px 15px;
                                border-radius: 8px;
                                cursor: pointer;
                                font-weight: bold;
                                transition: all 0.3s ease;
                            ">
                            🧹 Cleanup Old (30+ days)
                        </button>
                        <button onclick="closeRecoveryModal()" 
                            class="close-modal-btn" style="
                                background: linear-gradient(45deg, #6c757d, #5a6268);
                                color: white;
                                border: none;
                                padding: 10px 15px;
                                border-radius: 8px;
                                cursor: pointer;
                                font-weight: bold;
                                transition: all 0.3s ease;
                            ">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing recovery modal
        const existingModal = document.getElementById('recoveryModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Ensure modal styles are loaded
        this.addRecoveryModalStyles();
        
        // Show modal
        document.getElementById('recoveryModal').style.display = 'flex';
    }

    closeRecoveryModal() {
        const modal = document.getElementById('recoveryModal');
        if (modal) {
            modal.remove();
        }
    }

    async cleanupOldDeletedPlayers() {
        if (!this.isAdmin) {
            this.showNotification('Only admins can cleanup deleted players', 'error');
            return;
        }

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const oldDeletedPlayers = [];
        const sourceData = this.allPlayersData || this.localPlayers;
        
        Object.entries(sourceData).forEach(([playerName, playerData]) => {
            if (playerData.deleted && playerData.deletedAt < thirtyDaysAgo) {
                oldDeletedPlayers.push(playerName);
            }
        });

        if (oldDeletedPlayers.length === 0) {
            this.showNotification('No old deleted players to cleanup', 'info');
            return;
        }

        if (!confirm(`Permanently delete ${oldDeletedPlayers.length} player(s) deleted over 30 days ago? This cannot be undone!`)) {
            return;
        }

        try {
            for (const playerName of oldDeletedPlayers) {
                if (this.isConnected && this.playersRef) {
                    await this.playersRef.child(playerName).remove();
                } else {
                    // Local cleanup - work with allPlayersData if available
                    const sourceData = this.allPlayersData || this.localPlayers;
                    delete sourceData[playerName];
                    delete this.localPlayers[playerName]; // Also remove from display data
                }
            }
            
            this.showNotification(`${oldDeletedPlayers.length} old player(s) permanently deleted`, 'info');
        } catch (error) {
            console.error('Error cleaning up old deleted players:', error);
            this.showNotification('Failed to cleanup old deleted players', 'error');
        }
    }

    addRecoveryModalStyles() {
        // Check if styles are already loaded
        if (document.getElementById('recoveryModalStyles')) {
            return;
        }
        
        const style = document.createElement('style');
        style.id = 'recoveryModalStyles';
        style.textContent = `
            .recovery-modal {
                display: none;
                position: fixed;
                z-index: 2000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                align-items: center;
                justify-content: center;
            }
            
            .recovery-modal-content {
                backdrop-filter: blur(20px);
                background: rgba(255, 255, 255, 0.95);
                border-radius: 20px;
                padding: 30px;
                max-width: 800px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                color: #333;
            }
            
            .recovery-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 25px;
                border-bottom: 2px solid #eee;
                padding-bottom: 15px;
            }
            
            .recovery-modal-header h2 {
                color: #333;
                margin: 0;
                font-size: 1.5rem;
            }
            
            .recovery-modal .close-btn {
                background: none;
                border: none;
                font-size: 2rem;
                cursor: pointer;
                color: #999;
                padding: 0;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.3s ease;
            }
            
            .recovery-modal .close-btn:hover {
                background: rgba(0, 0, 0, 0.1);
                color: #333;
            }
            
            @media (max-width: 768px) {
                .recovery-modal-content {
                    width: 95%;
                    padding: 20px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Drag & Drop functionality
    handleDragStart(event, playerName) {
        if (!this.isAdmin) return;
        event.dataTransfer.setData("text/plain", playerName);
        event.dataTransfer.effectAllowed = "move";
        
        // Add visual feedback
        event.target.style.opacity = '0.5';
        console.log('🎯 Drag started for player:', playerName);
    }

    handleDragEnd(event) {
        // Remove visual feedback
        event.target.style.opacity = '';
        document.body.style.backgroundColor = '';
        console.log('🎯 Drag ended');
    }

    allowDrop(event) {
        if (this.isAdmin) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    async handleDrop(event, targetGroupIndex) {
        event.preventDefault();
        event.stopPropagation();

        const playerName = event.dataTransfer.getData("text/plain");

        if (!this.isAdmin || !playerName || !(playerName in this.localPlayers)) {
            console.warn('Drop ignored – invalid playerName:', playerName);
            return;
        }

        const targetGroup = this.groups[targetGroupIndex];
        if (!targetGroup) return;

        if (targetGroup.players.length >= targetGroup.maxSize) {
            this.showNotification("Target group is full!", "error");
            return;
        }

        const player = this.localPlayers[playerName];
        if (!player) return;

        try {
            // Store admin override to force this player into this specific group
            const adminOverrideId = `admin_group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).update({
                    // Player keeps ALL original tags - they are NEVER changed
                    adminGroupOverride: adminOverrideId, // Add admin override to force grouping
                    timestamp: Date.now() // Update timestamp for tracking
                });
                
                // Also update all other players in the target group to have the same override
                const updates = {};
                for (const targetPlayer of targetGroup.players) {
                    updates[`${targetPlayer.name}/adminGroupOverride`] = adminOverrideId;
                }
                if (Object.keys(updates).length > 0) {
                    await this.playersRef.update(updates);
                }
            } else {
                // Local mode
                this.localPlayers[playerName].adminGroupOverride = adminOverrideId;
                this.localPlayers[playerName].timestamp = Date.now();
                
                // Update target group players
                for (const targetPlayer of targetGroup.players) {
                    if (this.localPlayers[targetPlayer.name]) {
                        this.localPlayers[targetPlayer.name].adminGroupOverride = adminOverrideId;
                    }
                }
                this.reorganizeGroups();
            }

            this.showNotification(`${playerName} moved to group by admin (keeps original tags: ${player.marchLimit} marches, ${player.timeSlot})`, "info");
        } catch (error) {
            console.error("Error moving player:", error);
            this.showNotification("Failed to move player!", "error");
        }
    }

    // Create new group by dropping player outside existing groups
    async handleCreateNewGroup(event) {
        event.preventDefault();
        event.stopPropagation();

        const playerName = event.dataTransfer.getData("text/plain");
        console.log('🚀 handleCreateNewGroup called for player:', playerName);

        if (!this.isAdmin || !playerName || !(playerName in this.localPlayers)) {
            console.warn('❌ Create new group ignored – invalid conditions:', {
                isAdmin: this.isAdmin,
                playerName: playerName,
                playerExists: playerName in this.localPlayers
            });
            return;
        }

        const player = this.localPlayers[playerName];
        if (!player) {
            console.warn('❌ Player data not found:', playerName);
            return;
        }

        // Find which group this player is currently in
        let currentGroup = null;
        for (const group of this.groups) {
            if (group.players.some(p => p.name === playerName)) {
                currentGroup = group;
                break;
            }
        }

        // If player is alone in their group, no point in creating a new group
        if (!currentGroup || currentGroup.players.length <= 1) {
            console.log('ℹ️ Player is alone in group - no new group needed');
            this.showNotification(`${playerName} is already alone in their group`, "info");
            return;
        }

        console.log('✅ Creating new group for player:', playerName, 'from group with', currentGroup.players.length, 'players');

        try {
            // Create a timestamp that's significantly different from others to ensure separation
            const newTimestamp = Date.now() + (Math.random() * 60000) + 60000; // Random offset + 1 minute
            
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).update({
                    // Player keeps ALL original tags - they are NEVER changed
                    adminGroupOverride: null, // Remove any admin override to create independent group
                    timestamp: newTimestamp, // Significantly different timestamp to ensure new group
                    customGroupName: null // Remove custom name - new group gets default name
                });
                console.log('✅ Firebase updated for new group');
            } else {
                // Player keeps original tags, just update timestamp and remove overrides
                this.localPlayers[playerName].timestamp = newTimestamp;
                delete this.localPlayers[playerName].adminGroupOverride;
                delete this.localPlayers[playerName].customGroupName;
                console.log('✅ Local data updated for new group');
                this.reorganizeGroups();
            }

            this.showNotification(`${playerName} moved to new group (${player.marchLimit} marches, ${player.timeSlot})`, "success");
            console.log('✅ New group created successfully');
        } catch (error) {
            console.error('❌ Error creating new group:', error);
            this.showNotification("Failed to create new group!", "error");
        }
    }

    // Group renaming functionality (Admin only) - syncs to all users
    async renameGroup(groupIndex) {
        if (!this.isAdmin) {
            this.showNotification('Admin access required!', 'error');
            return;
        }

        const group = this.groups[groupIndex];
        if (!group) {
            this.showNotification('Group not found!', 'error');
            return;
        }

        const currentName = group.customName || `${this.config.allianceName} Group ${group.groupNumber}`;
        const newName = prompt(`Rename group (visible to ALL users):\n\nCurrent: ${currentName}`, currentName);
        
        if (newName === null || newName.trim() === '') {
            return; // User cancelled or entered empty name
        }

        const trimmedName = newName.trim();
        if (trimmedName === currentName) {
            return; // No change
        }

        try {
            // Update all players in this group with the custom group name
            // This will sync to ALL users via Firebase real-time database
            const updates = {};
            
            for (const player of group.players) {
                if (this.isConnected && this.playersRef) {
                    updates[`${player.name}/customGroupName`] = trimmedName;
                } else {
                    // Update locally (fallback mode)
                    if (this.localPlayers[player.name]) {
                        this.localPlayers[player.name].customGroupName = trimmedName;
                    }
                }
            }

            if (this.isConnected && this.playersRef && Object.keys(updates).length > 0) {
                // This updates Firebase and automatically syncs to ALL connected users
                await this.playersRef.update(updates);
                this.showNotification(`Group renamed to "${trimmedName}" (synced to all users)`, 'success');
            } else {
                this.reorganizeGroups();
                this.showNotification(`Group renamed to "${trimmedName}" (local only - no connection)`, 'info');
            }
            
        } catch (error) {
            console.error('Error renaming group:', error);
            this.showNotification('Failed to rename group!', 'error');
        }
    }

    // Reset group name to default (Admin only) - syncs to all users  
    async resetGroupName(groupIndex) {
        if (!this.isAdmin) {
            this.showNotification('Admin access required!', 'error');
            return;
        }

        const group = this.groups[groupIndex];
        if (!group || !group.customName) {
            return; // No custom name to reset
        }

        try {
            // Remove custom group name from all players in this group
            // This will sync to ALL users via Firebase real-time database
            const updates = {};
            
            for (const player of group.players) {
                if (this.isConnected && this.playersRef) {
                    updates[`${player.name}/customGroupName`] = null;
                } else {
                    // Update locally (fallback mode)
                    if (this.localPlayers[player.name]) {
                        delete this.localPlayers[player.name].customGroupName;
                    }
                }
            }

            if (this.isConnected && this.playersRef && Object.keys(updates).length > 0) {
                // This updates Firebase and automatically syncs to ALL connected users
                await this.playersRef.update(updates);
                this.showNotification('Group name reset (synced to all users)', 'info');
            } else {
                this.reorganizeGroups();
                this.showNotification('Group name reset (local only - no connection)', 'info');
            }
            
        } catch (error) {
            console.error('Error resetting group name:', error);
            this.showNotification('Failed to reset group name!', 'error');
        }
    }

    async handlePlayerSwap(event, targetPlayerName) {
        event.preventDefault();
        event.stopPropagation();

        const draggedPlayerName = event.dataTransfer.getData("text/plain");

        if (!this.isAdmin || !draggedPlayerName || !targetPlayerName) {
            return;
        }

        if (draggedPlayerName === targetPlayerName) {
            return; // Can't swap with itself
        }

        if (!(draggedPlayerName in this.localPlayers) || !(targetPlayerName in this.localPlayers)) {
            console.warn('Player swap ignored – invalid players');
            return;
        }

        const draggedPlayer = this.localPlayers[draggedPlayerName];
        const targetPlayer = this.localPlayers[targetPlayerName];

        if (!draggedPlayer || !targetPlayer) return;

        try {
            // Players keep their original tags, we just swap their timestamps and admin overrides to change positions
            const tempTimestamp = draggedPlayer.timestamp;
            const tempAdminOverride = draggedPlayer.adminGroupOverride;
            
            if (this.isConnected && this.playersRef) {
                // Update both players' timestamps and admin overrides to swap positions
                const updates = {};
                updates[`${draggedPlayerName}/timestamp`] = targetPlayer.timestamp;
                updates[`${draggedPlayerName}/adminGroupOverride`] = targetPlayer.adminGroupOverride || null;
                updates[`${targetPlayerName}/timestamp`] = tempTimestamp;
                updates[`${targetPlayerName}/adminGroupOverride`] = tempAdminOverride || null;
                
                await this.playersRef.update(updates);
            } else {
                // Update locally - swap timestamps and admin overrides, keep original tags
                this.localPlayers[draggedPlayerName].timestamp = targetPlayer.timestamp;
                this.localPlayers[draggedPlayerName].adminGroupOverride = targetPlayer.adminGroupOverride;
                this.localPlayers[targetPlayerName].timestamp = tempTimestamp;
                this.localPlayers[targetPlayerName].adminGroupOverride = tempAdminOverride;
                this.reorganizeGroups();
            }

            this.showNotification(`${draggedPlayerName} ⇄ ${targetPlayerName} swapped positions (kept original tags)`, "success");
        } catch (error) {
            console.error("Error swapping players:", error);
            this.showNotification("Failed to swap players!", "error");
        }
    }

    // Helper function to check if drop event should be blocked
    isEventInUIElement(event) {
        let target = event.target;
        
        // Debug logging
        console.log('Checking drop target:', target, 'className:', target.className);
        
        // Always allow drops outside the main container
        const container = document.querySelector('.container');
        if (!container || !container.contains(target)) {
            console.log('✅ Drop ALLOWED - outside main container');
            return false;
        }
        
        // Check if we're specifically in a group or other UI element that should block
        while (target && target !== container) {
            const className = target.className || '';
            
            // Block drops on specific UI elements
            if (className.includes('group') || 
                className.includes('player-item') || 
                className.includes('player-list') ||
                className.includes('header') ||
                className.includes('input-section') ||
                className.includes('admin-section') ||
                className.includes('floating-actions') ||
                className.includes('notification')) {
                console.log('❌ Drop BLOCKED - in UI element:', className);
                return true;
            }
            target = target.parentElement;
        }
        
        // If we're in the container but not in any specific UI element, allow drop
        console.log('✅ Drop ALLOWED - in empty space within container');
        return false;
    }

    // UI Management
    updateDisplay() {
        const container = document.getElementById('groupsContainer');
        
        if (Object.keys(this.localPlayers).length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No ${this.config.allianceName} Players Registered</h3>
                    <p>Add players to automatically create groups!</p>
                    <p>Choose march limit 1-6 and select your preferred time slot (including offline).</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                ${this.groups.map(group => {
                    // Check if this group has any search matches
                    let hasSearchMatch = false;
                    if (this.currentSearchTerm) {
                        hasSearchMatch = group.players.some(player => 
                            player.name.toLowerCase().includes(this.currentSearchTerm)
                        );
                    }
                    
                    return `
                        <div class="group ${group.isFull ? '' : 'waiting'} ${group.isOffline ? 'offline-group' : ''} ${group.isCustom ? 'custom-group' : ''} ${hasSearchMatch ? 'has-search-match' : ''}"
                            ondragover="kingshot.allowDrop(event)"
                            ondrop="kingshot.handleDrop(event, ${group.groupNumber - 1})">
                            
                            <div class="group-header">
                                <div class="group-title-row" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 5px;">
                                    <div class="group-title">${group.customName || `${this.config.allianceName} Group ${group.groupNumber}`}</div>
                                    ${this.isAdmin ? `
                                        <button onclick="kingshot.renameGroup(${group.groupNumber - 1})" class="rename-btn admin" title="Admin: Rename group" style="background: linear-gradient(45deg, #2196F3, #1976D2); color: white; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 0.7rem; opacity: 0.8; transition: all 0.3s ease;">✏️</button>
                                        ${group.customName ? `<button onclick="kingshot.resetGroupName(${group.groupNumber - 1})" class="reset-name-btn admin" title="Admin: Reset to default name" style="background: linear-gradient(45deg, #FF9800, #F57C00); color: white; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 0.7rem; opacity: 0.8; transition: all 0.3s ease;">🔄</button>` : ''}
                                    ` : ''}
                                </div>
                                <div class="time-badge" style="background: linear-gradient(45deg, #9C27B0, #673AB7); color: white; padding: 4px 12px; border-radius: 15px; font-size: 0.75rem; font-weight: bold; margin-bottom: 8px; display: inline-block;">${group.timeSlot}</div>
                                <div class="march-badge ${group.isOffline ? 'offline-badge' : ''} ${group.isCustom ? 'custom-badge' : ''}">${group.displayMarchLimit} march${group.displayMarchLimit > 1 ? 'es' : ''}</div>
                                <div class="group-count">
                                    ${group.players.length}/${group.maxSize} players
                                    ${group.isFull ? '✅' : '⏳'}
                                </div>
                            </div>
                            
                            <ul class="player-list">
                                ${group.players.map(player => {
                                    // Check if this player matches the search
                                    const isSearchMatch = this.currentSearchTerm && 
                                        player.name.toLowerCase().includes(this.currentSearchTerm);
                                    
                                    return `
                                        <li class="player-item ${isSearchMatch ? 'search-match' : ''}"
                                            draggable="${this.isAdmin}"
                                            ondragstart="kingshot.handleDragStart(event, '${player.name}')"
                                            ondragend="kingshot.handleDragEnd(event)"
                                            ondragover="kingshot.allowDrop(event)"
                                            ondrop="kingshot.handlePlayerSwap(event, '${player.name}')">
                                            
                                            <div class="player-info">
                                                <span class="player-name">${player.name}</span>
                                                <div class="player-march">${player.marchLimit} march limit</div>
                                                <div class="player-time" style="color: rgba(255, 255, 255, 0.6); font-size: 0.75rem; margin-top: 2px;">
                                                    ${(() => {
                                                        // Show preferred time if player is in a group that doesn't match their original time slot
                                                        const playerOriginalTimeSlot = player.timeSlot || 'at all times';
                                                        const groupTimeSlot = group.timeSlot;
                                                        
                                                        if (playerOriginalTimeSlot !== groupTimeSlot) {
                                                            return `preferred time: ${playerOriginalTimeSlot}`;
                                                        } else {
                                                            return playerOriginalTimeSlot;
                                                        }
                                                    })()}
                                                </div>
                                            </div>
                                            
                                            ${this.isAdmin ? `<button onclick="kingshot.removePlayer('${player.name}')" class="remove-btn admin" title="Admin: Remove player">✕</button>` : ''}
                                        </li>
                                    `;
                                }).join('')}
                            </ul>
                        </div>
                    `;
                }).join('')}
            `;
        }
        
        this.updateStats();
    }

    updateStats() {
        document.getElementById('totalPlayers').textContent = Object.keys(this.localPlayers).length;
        document.getElementById('totalGroups').textContent = this.groups.length;
        
        // Also update landing page stats if we're on an alliance page
        this.updateLandingPageStats();
    }
    
    updateLandingPageStats() {
        // Send stats to landing page via Firebase or localStorage
        try {
            const stats = {
                alliance: this.config.allianceName,
                playerCount: Object.keys(this.localPlayers).length,
                groupCount: this.groups.length,
                timestamp: Date.now()
            };
            
            // Store in localStorage so landing page can read it
            localStorage.setItem(`alliance_stats_${this.config.allianceName}`, JSON.stringify(stats));
            
            // Also try to update landing page directly if it's open in another tab
            if (typeof window !== 'undefined' && window.opener) {
                window.opener.postMessage({
                    type: 'ALLIANCE_STATS_UPDATE',
                    data: stats
                }, '*');
            }
        } catch (e) {
            // Ignore errors - landing page update is optional
        }
    }

    updateOnlineCount() {
        const count = Object.keys(this.localPlayers).length;
        const countEl = document.getElementById('onlineCount');
        countEl.textContent = `👥 ${count} ${this.config.allianceName} player${count !== 1 ? 's' : ''} registered`;
    }

    // Utility functions
    showFallbackMode() {
        const container = document.getElementById('groupsContainer');
        
        if (this.isAdmin) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>⚠️ Offline Mode</h3>
                    <p>Firebase is not configured. Running in local mode.</p>
                    <p>Players added here won't be shared with others.</p>
                    <p>March limit 1-6 create matching group sizes. Choose time slots including offline.</p>
                </div>
            `;
            this.updateConnectionStatus(false, 'Running in offline mode');
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No ${this.config.allianceName} Players Registered</h3>
                    <p>Add players to automatically create groups!</p>
                    <p>March limit 1-6 create matching group sizes. Choose your preferred time slot.</p>
                </div>
            `;
            this.updateConnectionStatus(false, 'Loading...');
        }
        
        this.enableInterface();
    }

    enableInterface() {
        document.getElementById('playerInput').disabled = false;
        document.getElementById('marchSelect').disabled = false;
        
        const timeSelect = document.getElementById('timeSelect');
        if (timeSelect) {
            timeSelect.disabled = false;
            // Initialize with default options if empty - UPDATED: Include offline
            if (timeSelect.options.length === 0) {
                const defaultOptions = [
                    { value: 'at all times', text: 'at all times', selected: true },
                    { value: 'offline', text: 'offline', selected: false }
                ];
                
                defaultOptions.forEach(optionData => {
                    const option = document.createElement('option');
                    option.value = optionData.value;
                    option.textContent = optionData.text;
                    option.selected = optionData.selected;
                    timeSelect.appendChild(option);
                });
            }
        }
        
        document.getElementById('addBtn').disabled = false;
        document.getElementById('searchInput').disabled = false;
        document.getElementById('playerInput').focus();
    }

    updateConnectionStatus(connected = this.isConnected, message = '') {
        const statusEl = document.getElementById('connectionStatus');
        const statusText = statusEl.querySelector('span');
        
        if (connected) {
            statusEl.className = 'connection-status connected';
            statusText.textContent = '🟢 Connected - Real-time sync active';
        } else if (message) {
            statusEl.className = 'connection-status disconnected';
            statusText.textContent = `🔴 ${message}`;
        } else {
            statusEl.className = 'connection-status disconnected';
            statusText.textContent = '🔴 Disconnected - Changes not synced';
        }
    }

    showAdminMode() {
        document.getElementById('adminStatus').classList.add('active');
        document.getElementById('adminLoginBtn').style.display = 'none';
        document.getElementById('adminLogoutBtn').style.display = 'inline-block';
        document.getElementById('clearBtn').style.display = 'block';
        document.getElementById('clearBtn').disabled = false;
        
        // Show time slot button for admins
        const timeSlotBtn = document.getElementById('timeSlotBtn');
        if (timeSlotBtn) {
            timeSlotBtn.style.display = 'block';
        }
        
        // Show recovery button for admins
        const recoveryBtn = document.getElementById('recoveryBtn');
        if (recoveryBtn) {
            recoveryBtn.style.display = 'block';
        }
        
        if (this.currentAdminUser) {
            const adminEmail = this.currentAdminUser.email;
            const displayEmail = adminEmail.length > 20 ? adminEmail.substring(0, 17) + '...' : adminEmail;
            document.getElementById('adminUser').textContent = displayEmail;
        }
    }

    hideAdminMode() {
        document.getElementById('adminStatus').classList.remove('active');
        document.getElementById('adminLoginBtn').style.display = 'inline-block';
        document.getElementById('adminLogoutBtn').style.display = 'none';
        document.getElementById('clearBtn').style.display = 'none';
        document.getElementById('adminUser').textContent = '';
        
        // Hide time slot button for non-admins
        const timeSlotBtn = document.getElementById('timeSlotBtn');
        if (timeSlotBtn) {
            timeSlotBtn.style.display = 'none';
        }
        
        // Hide recovery button for non-admins
        const recoveryBtn = document.getElementById('recoveryBtn');
        if (recoveryBtn) {
            recoveryBtn.style.display = 'none';
        }
    }

    showAuthError(message) {
        const errorEl = document.getElementById('authError');
        errorEl.textContent = message;
    }

    clearAuthError() {
        document.getElementById('authError').textContent = '';
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const notificationText = document.getElementById('notificationText');
        
        if (!notification || !notificationText) {
            console.warn('Notification elements not found');
            return;
        }
        
        notificationText.textContent = message;
        this._setNotificationStyle(notification, type);
        
        notification.classList.add(CSS_CLASSES.SHOW);
        
        setTimeout(() => {
            notification.classList.remove(CSS_CLASSES.SHOW);
        }, CONSTANTS.NOTIFICATION_DURATION);
    }

    _setNotificationStyle(notification, type) {
        const colors = {
            error: 'rgba(244, 67, 54, 0.9)',
            info: 'rgba(33, 150, 243, 0.9)',
            success: 'rgba(76, 175, 80, 0.9)'
        };
        
        notification.style.background = colors[type] || colors.success;
    }

    // Event listeners setup
    _setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            console.log(`DOM loaded, initializing ${this.config.allianceName} alliance...`);
            
            // Player input events
            const playerInput = document.getElementById('playerInput');
            if (playerInput) {
                playerInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.addPlayer();
                    }
                });
            }
            
            // Search events
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', () => this.searchPlayer());
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.searchPlayer();
                    }
                });
            }
            
            // Admin events
            const adminEmail = document.getElementById('adminEmail');
            if (adminEmail) {
                adminEmail.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        document.getElementById('adminPassword').focus();
                    }
                });
            }
            
            const adminPassword = document.getElementById('adminPassword');
            if (adminPassword) {
                adminPassword.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.adminLogin();
                    }
                });
            }

            // Global drop zone for creating new groups (admin only) - simplified approach
            document.addEventListener('dragover', (e) => {
                if (!this.isAdmin) return;
                
                const shouldAllow = !this.isEventInUIElement(e);
                if (shouldAllow) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🎯 Global dragover - allowing drop for new group creation');
                }
            });
            
            document.addEventListener('drop', (e) => {
                if (!this.isAdmin) return;
                
                const shouldAllow = !this.isEventInUIElement(e);
                if (shouldAllow) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🎯 Global drop triggered - creating new group');
                    this.handleCreateNewGroup(e);
                }
            });

            // Add visual feedback for drag operations
            document.addEventListener('dragenter', (e) => {
                if (this.isAdmin && !this.isEventInUIElement(e)) {
                    console.log('🎨 Visual feedback - highlighting drop zone');
                    document.body.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
                }
            });

            document.addEventListener('dragleave', (e) => {
                if (this.isAdmin && !e.relatedTarget) {
                    console.log('🎨 Visual feedback - removing highlight');
                    document.body.style.backgroundColor = '';
                }
            });

            document.addEventListener('dragend', (e) => {
                console.log('🎨 Drag ended - removing all visual feedback');
                document.body.style.backgroundColor = '';
            });

            // ESC key to close time slot modal
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const timeSlotModal = document.getElementById('timeSlotModal');
                    if (timeSlotModal && timeSlotModal.style.display === 'flex') {
                        this.closeTimeSlotModal();
                    }
                }
            });

            // Close modal when clicking outside
            document.addEventListener('click', (e) => {
                const timeSlotModal = document.getElementById('timeSlotModal');
                if (timeSlotModal && e.target === timeSlotModal) {
                    this.closeTimeSlotModal();
                }
            });
        });

        // Handle visibility change to reconnect if needed
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.isConnected) {
                setTimeout(() => this.initializeFirebase(), 1000);
            }
        });
    }
}

// Global functions for onclick handlers
function addPlayer() { kingshot.addPlayer(); }
function clearSearch() { kingshot.clearSearch(); }
function adminLogin() { kingshot.adminLogin(); }
function adminLogout() { kingshot.adminLogout(); }
function toggleAdminSection() { kingshot.toggleAdminSection(); }
function clearAllPlayers() { kingshot.clearAllPlayers(); }
function renameGroup(groupIndex) { kingshot.renameGroup(groupIndex); }
function resetGroupName(groupIndex) { kingshot.resetGroupName(groupIndex); }
function showTimeSlotManager() { 
    if (kingshot && kingshot.showTimeSlotManager) {
        kingshot.showTimeSlotManager();
    } else {
        console.error('showTimeSlotManager not available');
    }
}

// Close modal function needs to be available globally for the onclick handler
function closeTimeSlotModal() {
    if (kingshot && kingshot.closeTimeSlotModal) {
        kingshot.closeTimeSlotModal();
    }
}

function closeRecoveryModal() {
    if (kingshot && kingshot.closeRecoveryModal) {
        kingshot.closeRecoveryModal();
    }
}