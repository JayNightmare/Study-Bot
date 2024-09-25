const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize('sqlite:./database.sqlite');

// Define the User model
const User = sequelize.define('User', {
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: 'userServerIndex'
    },
    serverId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: 'userServerIndex'
    },
    studyStreak: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalStudyTime: {
        type: DataTypes.INTEGER,
        defaultValue: 0 // store study time in minutes or seconds
    },
    points: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    focusEnabled: {
        type: DataTypes.BOOLEAN, // New column to store focus status
        defaultValue: false, // Default to false (focus mode off)
    }
}); 
 
// Define the Server model
const Server = sequelize.define('Server', {
    serverId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    textChannelId: {
        type: DataTypes.STRING,
        allowNull: true // This can be null if not yet set
    },
    loggingChannelId: {
        type: DataTypes.STRING,
        allowNull: true // This can be null if not yet set
    },
    customStudyDuration: {
        type: DataTypes.INTEGER,
        defaultValue: 25 // default 25 minutes
    },
    customBreakDuration: {
        type: DataTypes.INTEGER,
        defaultValue: 5 // default 5 minutes
    }
});

// Define the Session model
const Session = sequelize.define('Session', {
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    joinTime: {
        type: DataTypes.DATE,
        allowNull: false
    },
    leaveTime: {
        type: DataTypes.DATE, // Nullable, to be filled when the user leaves the channel
        allowNull: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true // Marks if the session is currently active or ended
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    indexes: [
        {
            unique: false,
            fields: ['userId', 'guildId', 'active']
        }
    ]
});


// Sync the models with the database
sequelize.sync().then(() => {
    console.log('Database & tables created!');
});

module.exports = { User, Server, Session };
