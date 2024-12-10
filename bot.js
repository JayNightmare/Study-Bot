require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { Session, Server, User } = require('./models/sequelize.js');
const rest = new REST({ version: '10' }).setToken(process.env.LIVE_TOKEN);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });

const { // * User Data:
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
        awardPointsToUser,
    
        // * Session Data:
        handleSessionReactions,
} = require('./commands/utils.js');

const { logEvent, processLogs } = require('./commands/logEvents');

const communityCommands = require('./commands/community_commands/community.js');
const configCommands = require('./commands/config_commands/configs.js');

client.rest.on('rateLimit', (info) => {
    console.log(`Rate limit hit:
        Timeout: ${info.timeout}ms
        Limit: ${info.limit}
        Method: ${info.method}
        Path: ${info.path}
        Global: ${info.global}`);

    logEvent(serverId, 'Bot is rate limited', 'low');
});

// Define the commands
const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your study stats or another user\'s stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view stats for')
                .setRequired(false)
    ),

    new SlashCommandBuilder()
        .setName('start')
        .setDescription('Start a study session with a custom duration')
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('The study duration in minutes')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check the status of a study session using the session code')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('The session code for the study session')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the current study session with the session code')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('The session code for the study session')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the leaderboard'),
    
    new SlashCommandBuilder()
        .setName('settextchannel')
        .setDescription('Set the dedicated text channel for study session updates.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Select the channel for study session messages')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
    ),

    // Remove set text channel
    new SlashCommandBuilder()
        .setName('removetextchannel')
        .setDescription('Remove the dedicated text channel for study session updates.')
    ,

    new SlashCommandBuilder()
        .setName('setloggingchannel')
        .setDescription('Set the logging channel for updates.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Select the logging channel for updates')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
    ),

    new SlashCommandBuilder()
        .setName('setloglevel')
        .setDescription('Set the logging level for the bot.')
        .addStringOption(option =>
            option.setName('level')
            .setDescription('The logging level to set (low, medium, high)')
            .setRequired(true)
            .addChoices(
                { name: 'Low', value: 'low' },
                { name: 'Medium', value: 'medium' },
                { name: 'High', value: 'high' }
            )
    ),

    new SlashCommandBuilder()
        .setName('focus')
        .setDescription('Toggle focus mode to mute/hide all channels')
        .addBooleanOption(option =>
            option.setName('enable')
            .setDescription('Enable or disable focus mode')
            .setRequired(true)
    ),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup study session channels and roles')
        .addIntegerOption(option =>
            option.setName('voice_channels')
            .setDescription('Number of voice channels to create')
            .setRequired(true)
    )
];

client.on('guildCreate', async guild => {
    try {
        let server = await Server.findOne({ where: { serverId: guild.id } });

        if (!server) {
            // Add the new server to the database
            await Server.create({
                serverId: guild.id
            });
            console.log(`New server added to database: ${guild.name} (${guild.id})`);
        }
    } catch (error) {
        console.error(`Error adding new server ${guild.name} to the database:`, error);
    }
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        const guilds = await client.guilds.fetch();

        guilds.forEach(async (guild) => {
            const serverId = guild.id;
            logEvent(serverId, 'Bot has started up', 'low');

            try {
                // Check if the server exists in the database
                let server = await Server.findOne({ where: { serverId } });
                
                if (!server) {
                    // If not, create a new entry for the server
                    server = await Server.create({ serverId });
                    console.log(`Added server ${guild.name} (${serverId}) to the database.`);
                } else {
                    console.log(`Server ${guild.name} (${serverId}) already exists in the database.`);
                }

                // Register commands for the guild
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, serverId),
                    { body: commands }
                );

            } catch (error) {
                console.error(`Error registering commands or adding server ${guild.name} (${serverId}) to the database:`, error);
            }
        });

        console.log('All servers initialized in the database.');
        console.log('Successfully registered application (/) commands.');

    } catch (error) {
        console.error('Error fetching guilds:', error);
    }
});

let sessions = new Map(); // Store active study sessions
let prompts = new Map(); // Store ongoing prompts when the host leaves

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    if (!interaction.isCommand()) return;
    const { commandName, options, guildId } = interaction;
    let serverId = interaction.guild.id;

    try {
        if (commandName === 'setup') {
            
        }
    
        // //
    
        // * Community Commands
        if (commandName === 'focus') { communityCommands.focus.execute(interaction, options); }
        if (commandName === 'stats') { await communityCommands.stats.execute(interaction, options); }
        if (commandName === 'start') { await communityCommands.start.execute(interaction, options); } 
        if (commandName === 'status') { await communityCommands.status.execute(interaction, options); } 
        if (commandName === 'stop') { await communityCommands.stop.execute(interaction, options) } 
        if (commandName === 'leaderboard') { await communityCommands.leaderboard.execute(interaction, options); } 
        
        // //
    
        // * Config Commands
        if (commandName === 'settextchannel') { await configCommands.settextchannel.execute(interaction, options); }
        if (commandName ==='removetextchannel') { await configCommands.removetextchannel.execute(interaction, options); }
        if (commandName === 'setloggingchannel') { await configCommands.setloggingchannel.execute(interaction, options); }
        if (interaction.commandName === 'setloglevel') { await configCommands.setloglevel.execute(interaction, options); }
    } catch (e) {
        console.error(`Error executing command ${commandName} for server ${guildId}:`, e);
        await interaction.reply({ content: 'An error occurred while executing the command. Please try again later.', ephemeral: true });
    }
});

// Monitor voice state updates to detect when the host leaves
client.on('voiceStateUpdate', async (oldState, newState) => {
    let serverId = oldState.guild.id;
    
    // Check if a user left the voice channel
    if (!oldState.channelId && newState.channelId) {
        const joinTime = new Date();
        await addUserSession(newState.member.id, newState.channel.id, joinTime, newState.guild.id);
        
        const voiceChannel = newState.channel;
        const session = sessions.get(voiceChannel.id); // Get session by voice channel ID

        console.log(`!oldstate and new state: ${session}`);
        if (session) {
            // Fetch user focus setting from the database
            const user = await User.findOne({ where: { userId: newState.member.id, serverId: newState.guild.id } });

            if (user?.focusEnabled) {
                const focusRole = newState.guild.roles.cache.find(role => role.name === 'Focus');
                if (!focusRole) return console.log('Focus role not found.');

                // Add focus role to the user
                await newState.member.roles.add(focusRole).catch(console.error);
                console.log(`Assigned Focus role to ${newState.member.user.username}`);
            }
        }
    }

    // When user leaves a voice channel
    if (oldState.channelId && !newState.channelId) {
        const leaveTime = new Date();
        let sessionDuration;
        
        // Calculate session-specific duration
        // Automatically delete session code after 5 seconds
        setTimeout(async () => { sessionDuration = await endUserSession(oldState.member.id, oldState.channel.id, leaveTime, oldState.guild.id);}, 5000);

        if (sessionDuration > 0) {
            // Calculate points based on the session duration (1 point per minute)
            const points = Math.floor(sessionDuration / 60000); // Convert milliseconds to minutes
            console.log("Awarding points based on session duration:", points);

            // Award points to the user
            await awardPointsToUser(oldState.member.id, oldState.guild.id, points);
        }

        const focusRole = oldState.guild.roles.cache.find(role => role.name === 'Focus');
        if (!focusRole) return console.log('Focus role not found.');

        // Remove focus role when user leaves
        await oldState.member.roles.remove(focusRole).catch(console.error);
        console.log(`Removed Focus role from ${oldState.member.user.username}`);
    }

    const session = [...sessions.values()].find(s => s.userId === oldState.member.id && s.voiceChannelId === oldState.channelId);
    if (!session) {
        console.error(`No session found for user: ${oldState.member.id} in channel: ${oldState.channelId}`);
        return; // Exit if session is not found
    }

    if (!oldState?.channel) {
        console.error('Old state or old channel is null/undefined');
        return;
    }
    
    if (!oldState.member?.id) {
        console.error('Old state member is null/undefined');
        return;
    }    

    console.log(`Session Data (Voice Update): ${session}`);

    console.log('Sessions:', [...sessions.entries()]);

    const voiceChannel = oldState.channel;
    if (!voiceChannel) {
        console.error('Voice channel is null or undefined');
        return; // Exit if voiceChannel is not found
    }

    const updatedVoiceChannel = await client.channels.fetch(voiceChannel.id);

    const server = await Server.findOne({ where: { serverId: oldState.guild.id } });
    const textChannel = oldState.guild.channels.cache.get(server.textChannelId);

    // Find if the user was a host of any session
    console.log(`oldstate and !new state: ${session}`);
    if (!session) return;

    if (!server?.textChannelId) {
        console.error("No dedicated text channel set for this server.");
        return;
    }

    if (!textChannel) {
        console.error("Bot does not have permission to send messages in the configured text channel.");
        return;
    }

    /* Keep incase of error
        if (voiceChannel.members.size === 0) {
            // No one is left in the channel, automatically end the session
            await voiceChannel.setName(session.voiceChannelName).catch(console.error);
            sessions.delete(session.sessionCode);
            
            const embedStop = new EmbedBuilder()
            .setTitle('Session Ended')
            .setDescription('The session has ended as no one is left in the voice channel.')
            .setColor(0xE74C3C); // Red for stop
            await textChannel.send({ embeds: [embedStop] });
        
            logEvent(serverId, `Session ${session.sessionCode} ended because all members left ${voiceChannel}`, 'high')
            console.log("When members in VC = 0: Award Points to VC Members");
            await awardPointsToVCMembers(voiceChannel, session.duration);
        }
    */

    // if no members in the voice channel, automatically end the session
    if (updatedVoiceChannel.members.size === 0) {
        console.log(`Session Code For No Members: ${sessions.sessionCode}`);

        await updatedVoiceChannel.setName(session.voiceChannelName).catch(console.error);

        const embedStop = new EmbedBuilder()
            .setTitle('Session Suspended')
            .setDescription(`Session ${sessionCode} is suspended because the no one is left in ${updatedVoiceChannel}.\nSession will continue for ${session.duration} minutes.\n\n**Join back to receive points**`) 
            .addFields([
                {
                    name: 'Session Duration',
                    value: `${session.duration} minutes`,
                    inline: true
                },
                {
                    name: 'Join Back',
                    value: `Session VC: <#${updatedVoiceChannel.id}>`,
                    inline: true
                }
            ])  
            .setColor(0xE74C3C); // Red for stop
            
        await textChannel.send({ embeds: [embedStop] });
        
        logEvent(serverId, `Session ${sessionCode} is suspended because the host left ${updatedVoiceChannel}`, 'high')

        console.log("When host left: Award Points to VC Members");
        await awardPointsToVCMembers(updatedVoiceChannel, session.duration);  
    }
});

// Handle text message responses
client.on('messageCreate', async message => {
    if (!prompts.has(message.channel.id)) return;
    if (!prompts) return;

    const { sessionCode, timeout } = prompts.get(message.channel.id);

    if (message.content.toLowerCase().startsWith('yes') && message.content.includes(sessionCode)) {
        clearTimeout(timeout);
        prompts.delete(message.channel.id);

        const embedContinue = new EmbedBuilder()
            .setTitle('Session Continued')
            .setDescription(`The session with code ${sessionCode} will continue!`)
            .setColor(0x2ECC71); // Green for success
        await message.channel.send({ embeds: [embedContinue] });
    } else if (message.content.toLowerCase() === 'no') {
        clearTimeout(timeout);
        prompts.delete(message.channel.id);

        const session = sessions.get(sessionCode);
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);
        await voiceChannel.setName(session.voiceChannelName).catch(console.error);
        sessions.delete(sessionCode);

        const embedStop = new EmbedBuilder()
            .setTitle('Session Ended')
            .setDescription('The session has been stopped.')
            .setColor(0xE74C3C); // Red for stopped session
        await message.channel.send({ embeds: [embedStop] });

        await awardPointsToVCMembers(voiceChannel, session.duration);
    }
});

setInterval(() => processLogs(client), 180000);

client.login(process.env.LIVE_TOKEN);
