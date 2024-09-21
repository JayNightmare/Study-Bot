const { User, Server, Session } = require('../models/sequelize.js');
let userSessions = new Map(); // Key: userId, Value: { channelId, joinTime }

// * User Data:
async function updateUserStats(userId, serverId, studyTime) {
    try {
        let user = await User.findOne({ where: { userId, serverId } });
        
        if (!user) {
            user = await User.create({ userId, serverId });
        }

        user.studyStreak += 1;
        user.totalStudyTime += studyTime;
        user.points += studyTime; // Award points based on time studied

        console.log(`User ${userId} now has ${user.points} points.`);
        await user.save();
        
        return user;
    } catch (error) {
        console.error(`Failed to update stats for user ${userId}: ${error.message}`);
    }
}

async function addUserSession(userId, channelId, joinTime) {
    // Check if there is an existing session for this user
    const existingSession = await Session.findOne({
        where: { userId, channelId, active: true }
    });

    if (existingSession) {
        // Update join time if rejoining the same channel
        existingSession.joinTime = joinTime;
        await existingSession.save();
        console.log(`Updated session for user ${userId}`);
    } else {
        // Create a new session entry
        await Session.create({
            userId,
            channelId,
            joinTime,
            active: true // Mark this session as active
        });
        console.log(`Added session for user ${userId}`);
    }
}

async function endUserSession(userId, channelId, leaveTime) {
    // Find the active session for the user
    const session = await Session.findOne({
        where: { userId, channelId, active: true }
    });

    if (!session) {
        console.error(`No active session found for user ${userId} in channel ${channelId}`);
        return 0;
    }

    // Calculate the duration the user spent in the session (in milliseconds)
    const sessionDuration = leaveTime - new Date(session.joinTime);

    // Mark session as inactive and store the leave time
    session.leaveTime = leaveTime;
    session.active = false;
    await session.save();

    console.log(`Ended session for user ${userId}. Duration: ${sessionDuration} ms`);

    // Return the session duration in milliseconds for point calculation
    return sessionDuration;
}

// //

// Fetch the leaderboard (top 10 users)
async function getLeaderboard(serverId) {
    const leaderboard = await User.findAll({
        where: { serverId },
        order: [['points', 'DESC']],
        limit: 10
    });

    return leaderboard.map((user, index) => `${index + 1}. <@${user.userId}> - ${user.points} points`);
}

// //

async function getStudyDuration(serverId) {
    let server = await Server.findOne({ where: { serverId } });

    if (!server) {
        // Create default settings for the server if it doesn't exist
        server = await Server.create({ serverId });
    }

    return server.customStudyDuration;
}

// Helper function to generate a unique session code
function generateSessionCode() {
    return Math.random().toString(36).substr(2, 5).toUpperCase(); // Example: Generates a 5-character code
}

// //

// Award points to all members in the voice channel
async function awardPointsToVCMembers(voiceChannel, actualStudyTime) {
    const members = voiceChannel.members.filter(member => !member.user.bot); // Exclude bots

    for (const [memberId, member] of members) {
        const points = actualStudyTime; // Assuming 1 point per minute of study
        await updateUserStats(memberId, voiceChannel.guild.id, actualStudyTime); // Update points for each user

        // Notify users via DM
        try {
            const dm = new EmbedBuilder()
                .setTitle('Study Points Earned')
                .setDescription(`You earned ${points} points for studying ${actualStudyTime} minutes!`)
                .setColor(0x3498DB); // Blue for info
            await member.send({ embeds: [dm] });
        } catch (error) {
            console.error(`Could not DM user ${memberId}`, error);
        }
    }
}

async function awardPointsToUser(userId, serverId, points) {
    let user = await User.findOne({ where: { userId, serverId } });
    
    if (!user) {
        // If user doesn't exist, create a new record
        user = await User.create({ userId, serverId });
    }

    user.points += points;
    await user.save();
    console.log(`Awarded ${points} points to user ${userId}. Total points: ${user.points}`);
}



// //

module.exports = {
    // * User Data:
    updateUserStats,
    addUserSession,
    endUserSession,

    // * Leaderboard Data:
    getLeaderboard,

    // * Study Duration Data:
    getStudyDuration,
    generateSessionCode,

    // * Points Data:
    awardPointsToVCMembers,
    awardPointsToUser
}