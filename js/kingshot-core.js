/**
 * Kingshot Vikings Event - Core Library
 * Shared functionality for all alliances
 */

class KingshotCore {
    constructor(config) {
        // Alliance-specific configuration
        this.config = {
            allianceName: config.allianceName || 'COB',
            colors: config.colors || {
                primary: 'linear-gradient(90deg, #FF6B6B, #FF8E53)',
                badge: 'linear-gradient(45deg, #FF6B6B, #FF8E53)',
                group: 'linear-gradient(90deg, #FF6B6B, #FF8E53)'
            },
            emoji: config.emoji || '🔥',
            firebaseConfig: config.firebaseConfig,
            ...config
        };

        // Firebase variables
        this.database = null;
        this.auth = null;
        this.isConnected = false;
        this.playersRef = null;
        this.connectionRef = null;

        // State variables
        this.localPlayers = {};
        this.groups = [];
        this.isAdmin = false;
        this.currentPlayerName = '';
        this.currentAdminUser = null;
        this.currentSearchTerm = '';

        // Initialize
        this.initializeFirebase();
        this.setupEventListeners();
        this.applyAllianceStyles();
    }

    // Apply alliance-specific styles
    applyAllianceStyles() {
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
    async initializeFirebase() {
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
            console.log(`${this.config.allianceName} playersRef initialized`);
            
            // Listen for player changes
            this.playersRef.on('value', (snapshot) => {
                const data = snapshot.val();
                this.localPlayers = data || {};
                this.reorganizeGroups();
                this.updateOnlineCount();
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
        const playerName = input.value.trim();
        const marchValue = marchSelect.value;
        
        if (playerName === '') {
            this.showNotification('Please enter a player name!', 'error');
            return;
        }
        
        if (this.localPlayers[playerName]) {
            this.showNotification(`This player is already registered in ${this.config.allianceName}!`, 'error');
            return;
        }

        try {
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).set({
                    marchLimit: marchValue,
                    timestamp: Date.now()
                });
                this.currentPlayerName = playerName;
                
                const displayText = marchValue === 'offline' ? 'offline player' : `${marchValue} rallies`;
                this.showNotification(`${playerName} joined ${this.config.allianceName} as ${displayText}!`, 'success');
            } else {
                // Fallback to local mode
                this.localPlayers[playerName] = {
                    marchLimit: marchValue,
                    timestamp: Date.now()
                };
                this.currentPlayerName = playerName;
                this.reorganizeGroups();
                
                const displayText = marchValue === 'offline' ? 'offline player' : `${marchValue} rallies`;
                if (this.isAdmin) {
                    this.showNotification(`${playerName} added locally to ${this.config.allianceName}`, 'info');
                } else {
                    this.showNotification(`${playerName} joined ${this.config.allianceName} as ${displayText}!`, 'success');
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
                await this.playersRef.child(playerName).remove();
                
                if (playerName === this.currentPlayerName) {
                    this.currentPlayerName = '';
                }
                
                this.showNotification(`${playerName} left ${this.config.allianceName}`, 'info');
            } else {
                // Fallback to local mode
                delete this.localPlayers[playerName];
                
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
        
        // Create an array of all players with their info and find earliest timestamp for each march limit
        const allPlayers = [];
        const earliestTimestampByMarch = {};
        
        Object.entries(this.localPlayers).forEach(([playerName, playerData]) => {
            const marchLimit = playerData.marchLimit || 3;
            const timestamp = playerData.timestamp || 0;
            
            allPlayers.push({
                name: playerName,
                marchLimit: marchLimit,
                timestamp: timestamp
            });
            
            // Track earliest timestamp for each march limit to determine group order
            if (!earliestTimestampByMarch[marchLimit] || timestamp < earliestTimestampByMarch[marchLimit]) {
                earliestTimestampByMarch[marchLimit] = timestamp;
            }
        });
        
        // Sort players by timestamp (first come, first served)
        allPlayers.sort((a, b) => a.timestamp - b.timestamp);
        
        // Group players by march limit but maintain timestamp order within groups
        const playersByMarchLimit = {};
        allPlayers.forEach(player => {
            const marchLimit = player.marchLimit;
            if (!playersByMarchLimit[marchLimit]) {
                playersByMarchLimit[marchLimit] = [];
            }
            playersByMarchLimit[marchLimit].push(player);
        });
        
        // Create groups ordered by earliest player timestamp in each march category
        const marchLimitsByFirstPlayer = Object.keys(playersByMarchLimit).sort((a, b) => {
            return earliestTimestampByMarch[a] - earliestTimestampByMarch[b];
        });
        
        marchLimitsByFirstPlayer.forEach(marchLimit => {
            const players = playersByMarchLimit[marchLimit];
            let groupSize;
            let isNewGroup = false;
            
            // Extract original march limit (remove newgroup identifier if present)
            const originalMarchLimit = marchLimit.toString().split('_newgroup_')[0];
            
            // Determine group size based on march type
            if (originalMarchLimit === 'offline') {
                groupSize = 4; // Offline players in 4-player groups
            } else if (marchLimit.includes('_newgroup_')) {
                // New groups created by drag & drop - use original march limit for size
                groupSize = parseInt(originalMarchLimit);
                isNewGroup = true;
            } else {
                groupSize = parseInt(marchLimit); // Group size matches march limit
            }
            
            // Split players into groups in order
            for (let i = 0; i < players.length; i += groupSize) {
                const group = players.slice(i, i + groupSize);
                
                let displayMarchLimit = originalMarchLimit;
                let groupType = '';
                
                // Check if any player in this group has a custom group name
                let customGroupName = null;
                for (const player of group) {
                    const playerData = this.localPlayers[player.name];
                    if (playerData && playerData.customGroupName) {
                        customGroupName = playerData.customGroupName;
                        break; // Use the first custom name found
                    }
                }
                
                this.groups.push({
                    players: group,
                    marchLimit: marchLimit,
                    displayMarchLimit: displayMarchLimit,
                    groupNumber: this.groups.length + 1,
                    maxSize: groupSize,
                    isFull: group.length === groupSize,
                    isOffline: originalMarchLimit === 'offline',
                    isCustom: false,
                    groupType: groupType,
                    customName: customGroupName
                });
            }
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

    // Drag & Drop functionality
    handleDragStart(event, playerName) {
        if (!this.isAdmin) return;
        event.dataTransfer.setData("text/plain", playerName);
        event.dataTransfer.effectAllowed = "move";
        
        // Add visual feedback
        event.target.style.opacity = '0.5';
    }

    handleDragEnd(event) {
        // Remove visual feedback
        event.target.style.opacity = '';
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
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).update({
                    marchLimit: targetGroup.marchLimit,
                    timestamp: Date.now(),
                });
            } else {
                this.localPlayers[playerName].marchLimit = targetGroup.marchLimit;
                this.localPlayers[playerName].timestamp = Date.now();
                this.reorganizeGroups();
            }

            this.showNotification(`${playerName} moved to ${this.config.allianceName} ${targetGroup.marchLimit === 'offline' ? 'offline' : targetGroup.marchLimit + ' march'} group`, "info");
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

        if (!this.isAdmin || !playerName || !(playerName in this.localPlayers)) {
            console.warn('Create new group ignored – invalid playerName:', playerName);
            return;
        }

        const player = this.localPlayers[playerName];
        if (!player) return;

        try {
            // Create a unique march limit for new group (preserve original march limit + unique identifier)
            const originalMarchLimit = player.marchLimit.toString().split('_newgroup_')[0]; // Remove any existing identifier
            const uniqueMarchLimit = `${originalMarchLimit}_newgroup_${Date.now()}`;
            
            if (this.isConnected && this.playersRef) {
                await this.playersRef.child(playerName).update({
                    marchLimit: uniqueMarchLimit,
                    timestamp: Date.now(),
                });
            } else {
                this.localPlayers[playerName].marchLimit = uniqueMarchLimit;
                this.localPlayers[playerName].timestamp = Date.now();
                this.reorganizeGroups();
            }

            const displayMarch = originalMarchLimit === 'offline' ? 'offline' : `${originalMarchLimit} march`;
            this.showNotification(`${playerName} moved to new ${displayMarch} group`, "success");
        } catch (error) {
            console.error("Error creating new group:", error);
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
            // Swap march limits
            const tempMarchLimit = draggedPlayer.marchLimit;
            
            if (this.isConnected && this.playersRef) {
                // Update both players simultaneously
                const updates = {};
                updates[`${draggedPlayerName}/marchLimit`] = targetPlayer.marchLimit;
                updates[`${draggedPlayerName}/timestamp`] = Date.now();
                updates[`${targetPlayerName}/marchLimit`] = tempMarchLimit;
                updates[`${targetPlayerName}/timestamp`] = Date.now();
                
                await this.playersRef.update(updates);
            } else {
                // Update locally
                this.localPlayers[draggedPlayerName].marchLimit = targetPlayer.marchLimit;
                this.localPlayers[draggedPlayerName].timestamp = Date.now();
                this.localPlayers[targetPlayerName].marchLimit = tempMarchLimit;
                this.localPlayers[targetPlayerName].timestamp = Date.now();
                this.reorganizeGroups();
            }

            this.showNotification(`${draggedPlayerName} ⇄ ${targetPlayerName} swapped positions`, "success");
        } catch (error) {
            console.error("Error swapping players:", error);
            this.showNotification("Failed to swap players!", "error");
        }
    }

    // Helper function to check if drop event should be blocked
    isEventInUIElement(event) {
        let target = event.target;
        
        // Allow drops completely outside the container (e.g., page margins)
        const container = document.querySelector('.container');
        if (container && !container.contains(target)) {
            return false; // Allow drop outside container
        }
        
        // Check if inside specific UI elements that should block drops
        while (target && target !== document.body) {
            if (target.classList && (
                target.classList.contains('group') || 
                target.classList.contains('admin-drop-zone') ||
                target.classList.contains('header') ||
                target.classList.contains('input-section') ||
                target.classList.contains('admin-section') ||
                target.classList.contains('floating-actions') ||
                target.classList.contains('notification')
            )) {
                return true; // Block drop in these elements
            }
            target = target.parentElement;
        }
        
        return false; // Allow drop in empty spaces
    }

    // UI Management
    updateDisplay() {
        const container = document.getElementById('groupsContainer');
        
        if (Object.keys(this.localPlayers).length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No ${this.config.allianceName} Players Registered</h3>
                    <p>Add players to automatically create groups!</p>
                    <p>March limit 1-6 create matching group sizes. Offline players form 4-player groups.</p>
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
                                <div class="march-badge ${group.isOffline ? 'offline-badge' : ''} ${group.isCustom ? 'custom-badge' : ''}">${group.isOffline ? 'Offline' : group.isCustom ? 'Custom Group' : `${group.displayMarchLimit} march${group.displayMarchLimit > 1 ? 'es' : ''}`}</div>
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
                                                <div class="player-march">${player.marchLimit.split('_newgroup_')[0] === 'offline' ? 'Offline player' : `${player.marchLimit.split('_newgroup_')[0]} march limit`}</div>
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
                    <p>March limit 1-6 create matching group sizes. Offline players form 4-player groups.</p>
                </div>
            `;
            this.updateConnectionStatus(false, 'Running in offline mode');
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No ${this.config.allianceName} Players Registered</h3>
                    <p>Add players to automatically create groups!</p>
                    <p>March limit 1-6 create matching group sizes. Offline players form 4-player groups.</p>
                </div>
            `;
            this.updateConnectionStatus(false, 'Loading...');
        }
        
        this.enableInterface();
    }

    enableInterface() {
        document.getElementById('playerInput').disabled = false;
        document.getElementById('marchSelect').disabled = false;
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
        
        notificationText.textContent = message;
        
        // Color based on type
        if (type === 'error') {
            notification.style.background = 'rgba(244, 67, 54, 0.9)';
        } else if (type === 'info') {
            notification.style.background = 'rgba(33, 150, 243, 0.9)';
        } else {
            notification.style.background = 'rgba(76, 175, 80, 0.9)';
        }
        
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);
    }

    // Event listeners setup
    setupEventListeners() {
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

            // Global drop zone for creating new groups (admin only) - anywhere outside UI elements
            document.addEventListener('dragover', (e) => {
                if (this.isAdmin && !this.isEventInUIElement(e)) {
                    this.allowDrop(e);
                }
            });
            
            document.addEventListener('drop', (e) => {
                if (this.isAdmin && !this.isEventInUIElement(e)) {
                    this.handleCreateNewGroup(e);
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