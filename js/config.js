/**
 * Kingshot Vikings Event - Centralized Configuration
 * Single source of truth for all application settings
 */

// ===== FIREBASE CONFIGURATION =====
const KINGSHOT_CONFIG = {
    // Firebase settings (shared across all pages)
    firebase: {
        apiKey: "AIzaSyBKHPSmLcbyZ8xItGLHZA-nEMB5E3joczw",
        authDomain: "kingshot-vikings-event.firebaseapp.com",
        databaseURL: "https://kingshot-vikings-event-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "kingshot-vikings-event",
        storageBucket: "kingshot-vikings-event.firebasestorage.app",
        messagingSenderId: "308452962352",
        appId: "1:308452962352:web:e18535f956c3386c033df5"
    },

    // Application constants
    app: {
        notificationDuration: 4000,
        defaultAlliances: ['COB', 'LUX', 'GEW'],
        defaultTimeSlots: ['at all times', 'offline'],
        maxMarchLimit: 6,
        minMarchLimit: 1,
        groupTimeThreshold: 10000 // 10 seconds in milliseconds
    },

    // Alliance-specific configurations
    alliances: {
        COB: {
            name: 'COB',
            emoji: '🔥',
            fullName: 'COB Alliance',
            colors: {
                primary: 'linear-gradient(90deg, #FF6B6B, #FF8E53)',
                badge: 'linear-gradient(45deg, #FF6B6B, #FF8E53)',
                group: 'linear-gradient(90deg, #FF6B6B, #FF8E53)'
            }
        },
        LUX: {
            name: 'LUX',
            emoji: '✨',
            fullName: 'LUX Alliance',
            colors: {
                primary: 'linear-gradient(90deg, #4ECDC4, #44A08D)',
                badge: 'linear-gradient(45deg, #4ECDC4, #44A08D)',
                group: 'linear-gradient(90deg, #4ECDC4, #44A08D)'
            }
        },
        GEW: {
            name: 'GEW',
            emoji: '🌟',
            fullName: 'GEW Alliance',
            colors: {
                primary: 'linear-gradient(90deg, #A8E6CF, #7FCDCD)',
                badge: 'linear-gradient(45deg, #A8E6CF, #7FCDCD)',
                group: 'linear-gradient(90deg, #A8E6CF, #7FCDCD)'
            }
        }
    }
};

// ===== CONFIGURATION HELPER FUNCTIONS =====

/**
 * Get alliance configuration by name
 * @param {string} allianceName - Name of the alliance (COB, LUX, GEW)
 * @returns {Object} Alliance configuration object
 */
function getAllianceConfig(allianceName) {
    const config = KINGSHOT_CONFIG.alliances[allianceName.toUpperCase()];
    if (!config) {
        console.warn(`Alliance configuration not found for: ${allianceName}`);
        return KINGSHOT_CONFIG.alliances.COB; // Fallback to COB
    }
    return config;
}

/**
 * Get Firebase configuration
 * @returns {Object} Firebase configuration object
 */
function getFirebaseConfig() {
    return KINGSHOT_CONFIG.firebase;
}

/**
 * Get application constants
 * @returns {Object} Application constants object
 */
function getAppConfig() {
    return KINGSHOT_CONFIG.app;
}

/**
 * Create alliance configuration for KingshotCore
 * @param {string} allianceName - Name of the alliance
 * @returns {Object} Configuration object for KingshotCore constructor
 */
function createAllianceConfigForCore(allianceName) {
    const allianceConfig = getAllianceConfig(allianceName);
    return {
        allianceName: allianceConfig.name,
        emoji: allianceConfig.emoji,
        colors: allianceConfig.colors,
        firebaseConfig: getFirebaseConfig()
    };
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        KINGSHOT_CONFIG,
        getAllianceConfig,
        getFirebaseConfig,
        getAppConfig,
        createAllianceConfigForCore
    };
}