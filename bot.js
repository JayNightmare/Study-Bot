const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { Session, Server, User } = require('./models/sequelize.js');
require('dotenv').config();
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


const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const rest = new REST({ version: '10' }).setToken(process.env.TEST_TOKEN);


client.rest.on('rateLimit', (info) => {
    console.log(`Rate limit hit:
        Timeout: ${info.timeout}ms
        Limit: ${info.limit}
        Method: ${info.method}
        Path: ${info.path}
        Global: ${info.global}`);

    logEvent(serverId, 'Bot is rate limited', 'low');
});

// Example function that adds a role with error and rate-limit handling
async function assignRoleWithLimitCheck(member, role) {
    try {
        await member.roles.add(role);
        console.log(`Added role to ${member.user.tag}`);
    } catch (error) {
        if (error.httpStatus === 429) {
            // Handle the rate limit
            const retryAfter = error.retry_after || 1000; // Retry after time in ms
            console.log(`Rate limit hit! Retrying after ${retryAfter}ms`);
            setTimeout(() => assignRoleWithLimitCheck(member, role), retryAfter);
        } else {
            console.error(`Failed to assign role: ${error.message}`);
        }
    }
}

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
        // Fetch all guilds (servers) the bot is in
        const guilds = await client.guilds.fetch();

        // Log an event for each server the bot is in
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
const sessionCodes = new Map();

// function getSessionCode(vcId) {
//     return sessionCodes.get(vcId);
// }

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    if (!interaction.isCommand()) return;
    const { commandName, options, guildId } = interaction;
    let serverId = interaction.guild.id;

    if (interaction.commandName === 'focus') {
        logEvent(serverId, 'Focus Command Run', 'high');
        await interaction.deferReply();

        const enableFocus = interaction.options.getBoolean('enable');

        const focusRole = interaction.guild.roles.cache.find(role => role.name === 'Focus');
        if (!focusRole) return interaction.editReply('Focus role not found.');

        if (enableFocus) {
            await interaction.member.roles.add(focusRole);
            await interaction.editReply({ content: 'Focus mode enabled. You will now have limited access for better concentration.', ephemeral: true });
        } else {
            await interaction.member.roles.remove(focusRole);
            await interaction.editReply({ content: 'Focus mode disabled. You now have access to all channels again.', ephemeral: true });
        }

        // Fetch the user from the database
        let user = await User.findOne({ where: { userId: interaction.user.id, serverId: interaction.guild.id } });

        if (!user) {
            // Create the user in the database if they don't exist
            user = await User.create({
                userId: interaction.user.id,
                serverId: interaction.guild.id,
                focusEnabled: enableFocus
            });
        } else {
            // Update the user's focus mode
            user.focusEnabled = enableFocus;
            await user.save();
        }

        // Respond to the user
        if (enableFocus) {
            await interaction.editReply({ content: 'Focus mode enabled. You will now have limited access for better concentration.', ephemeral: true });
        } else {
            await interaction.editReply({ content: 'Focus mode disabled. You now have access to all channels again.', ephemeral: true });
        }
    }

    // //

    else if (interaction.commandName === 'setup') {
        logEvent(serverId, 'Setup Command Run', 'low');
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'You need to be an admin to run this command.', ephemeral: true });
        }

        const numVoiceChannels = interaction.options.getInteger('voice_channels');

        // Check if the server is already setup
        let server = await Server.findOne({ where: { serverId: interaction.guild.id } });
        if (server?.textChannelId) {
            return interaction.reply({ content: 'This server is already set up.', ephemeral: true });
        }

        try {
            // Defer the reply to allow time for the setup to complete
            await interaction.deferReply({ ephemeral: true });

            // Step 1: Create a category
            const category = await interaction.guild.channels.create({
                name: 'Study Focus',
                type: 4, // Category type
                permissionOverwrites: [
                    {
                        id: interaction.guild.id, // Default permissions for everyone
                        deny: [PermissionsBitField.Flags.ViewChannel], // Deny viewing for everyone by default
                    }
                ]
            });

            // Step 2: Create a text channel in the category
            const textChannel = await interaction.guild.channels.create({
                name: 'study-text',
                type: 0, // Text channel type
                parent: category.id, // Place it under the category
                permissionOverwrites: [
                    {
                        id: interaction.guild.id, // Default permissions for everyone
                        deny: [PermissionsBitField.Flags.ViewChannel], // Hide it for everyone except focus role
                    }
                ]
            });

            // Step 3: Create voice channels in the category
            for (let i = 1; i <= numVoiceChannels; i++) {
                await interaction.guild.channels.create({
                    name: `Study VC ${i}`,
                    type: 2, // Voice channel type
                    parent: category.id, // Place it under the category
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id, // Default permissions for everyone
                            deny: [PermissionsBitField.Flags.ViewChannel], // Hide it for everyone except focus role
                        }
                    ]
                });
            }

            // Step 4: Create the Focus role
            let focusRole = interaction.guild.roles.cache.find(role => role.name === 'Focus');
            if (!focusRole) {
                focusRole = await interaction.guild.roles.create({
                    name: 'Focus',
                    color: 0xe71563, // Use your custom hex color code
                    reason: 'Role for focused study sessions',
                });
            }

            // Step 5: Update permissions for all other channels to deny view for Focus role
            interaction.guild.channels.cache.forEach(channel => {
                if (channel.parentId !== category.id) { // Don't modify the new category
                    channel.permissionOverwrites.edit(focusRole, {
                        ViewChannel: false, // Hide other channels from focus role
                    });
                } else {
                    channel.permissionOverwrites.edit(focusRole, {
                        ViewChannel: true, // Allow view of new study channels
                    });
                }
            });

            // Step 6: Save the text channel ID to the database
            if (!server) {
                server = await Server.create({
                    serverId: interaction.guild.id,
                    textChannelId: textChannel.id, // Store the text channel ID
                    customStudyDuration: 25, // Default settings
                    customBreakDuration: 5
                });
            } else {
                server.textChannelId = textChannel.id;
                await server.save();
            }

            // Finalize the setup process and reply to the user
            await interaction.editReply({ content: 'Study setup complete!' });

        } catch (error) {
            console.error('Setup failed:', error);
            await interaction.editReply({ content: 'An error occurred during setup.' });
        }
    }

    // //

    else if (commandName === 'stats') {
        logEvent(serverId, 'Stats Command Run', 'high');
        const server = await Server.findOne({ where: { serverId: interaction.guild.id } });

        // defer reply
        await interaction.deferReply();

        if (server && server.textChannelId !== interaction.channelId) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Channel')
                .setDescription('This command can only be used in the designated study session channel.')
                .addFields({
                    name: 'Study Session Channel',
                    value: `<#${server.textChannelId}>`
                })
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Fetch the user whose stats to show
        const user = interaction.options.getUser('user') || interaction.user;

        // Fetch user stats from the database
        const userData = await User.findOne({ where: { userId: user.id, serverId: interaction.guild.id } });
        if (!userData) {
            const embed = new EmbedBuilder()
                .setTitle('No Stats Found')
                .setDescription(`No study stats found for ${user.tag}.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // Fetch leaderboard to get the user's rank
        const leaderboard = await getLeaderboard(interaction.guild.id);
        const rank = leaderboard.findIndex(u => u.userId === user.id) + 1; // Find the user's rank in the leaderboard

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Study Stats`)
            .setThumbnail(user.displayAvatarURL()) // Display their avatar
            .addFields([
                { name: '⌛ Study Time ⌛ |', value: `\`${userData.totalStudyTime}\` minutes`, inline: true },
                { name: '🏅 Total Points 🏅', value: `\`${userData.points}\``, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '🔥 Study Streak 🔥', value: `\`${userData.studyStreak}\` days`, inline: true },
                { name: '🏆 Rank 🏆', value: rank ? `#${rank}` : 'Unranked', inline: true },
            ])
            .setColor(0x3498DB); // Blue for info

        await interaction.editReply({ embeds: [embed] });
    }

    // //

    else if (commandName === 'start') {
        logEvent(serverId, 'Start Session Command Run', 'medium');
        try {
            console.log('Start Command Run');

            const duration = interaction.options.getInteger('duration');

            if (duration < 4) {
                // Send embed saying, this is not long enough
                const embed = new EmbedBuilder()
                    .setTitle('Invalid Duration')
                    .setDescription('The study duration must be at least 5 minutes.')
                    .setColor(0xE74C3C);

                    await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.deferReply();
    
                const user = interaction.user;
                const member = await interaction.guild.members.fetch(user.id);
                const voiceChannel = member.voice.channel;
    
                const server = await Server.findOne({ where: { serverId: interaction.guild.id } });
                const displayServerChannel = server.textChannelId;

                // if display server channel is null then display "/settextchannel"
                if (!displayServerChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('No Text Channel Set')
                        .setDescription('This command can only be used in the designated study session channel')
                        .addFields({
                            name: 'Study Session Channel',
                            value: `run \`/settextchannel\``
                        })
                        .setColor(0xE74C3C); // Red for error
                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                    return;
                }
    
                if (server && server.textChannelId !== interaction.channelId) {
                    const embed = new EmbedBuilder()
                        .setColor(0xE74C3C) // Red for error
                        .setTitle('Invalid Channel')
                        .setDescription('This command can only be used in the designated study session channel')
                        .addFields({
                            name: 'Study Session Channel',
                            value: `<#${displayServerChannel}>`
                        });
                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                    return;
                }
        
                if (!voiceChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('Error')
                        .setDescription('You need to be in a voice channel to start a study session.')
                        .setColor(0xE74C3C); // Red for error
                    await interaction.editReply({ embeds: [embed] });
                    return;
                }
    
                 // Check if the voice channel already has an active session
                const activeSession = Array.from(sessions.values()).find(session => session.voiceChannelId === voiceChannel.id);

                if (activeSession) {
                    // If a session is already active in this voice channel, prevent starting a new one
                    const embed = new EmbedBuilder()
                        .setTitle('Active Session Already Running')
                        .setDescription('There is already an active study session in this voice channel. You cannot start a new session until the current one ends.')
                        .setColor(0xE74C3C); // Red for error
                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                    return;
                }
        
                // Generate a unique code for this session
                sessionCode = generateSessionCode();
        
                // Store the session info
                sessions.set(sessionCode, {
                    userId: user.id,
                    voiceChannelId: voiceChannel.id,
                    startTime: Date.now(),
                    duration, 
                    voiceChannelName: voiceChannel.name,
                    guildId: interaction.guild.id,
                    pointsPerMinute: 1
                }); 
        
                // Optionally, update the voice channel name
                voiceChannel.setName(`${duration} [${sessionCode}]`).catch(console.error);
        
                const embed = new EmbedBuilder()
                    .setTitle('Study Session Started')
                    .setDescription(`Your study session has started! It will last for ${duration} minutes.`)
                    .setColor(0x2ECC71) // Green for success
                    .addFields([
                        { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                        { name: 'Time', value: `${duration} minutes`, inline: true },
                        { name: 'Session Code', value: sessionCode, inline: true }
                    ]);
        
                await interaction.editReply({ embeds: [embed] });
        
                // Set a timeout to end the session after the specified duration
                setTimeout(async () => {
                    const session = sessions.get(sessionCode);
                    if (session) {
                        // Rename the channel to "Study VC"
                        await voiceChannel.setName("Study VC").catch(console.error);
                        const textChannel = interaction.guild.systemChannel || interaction.channel;

                        // Award points to VC members
                        const points = session.pointsPerMinute * session.duration;
                        const members = voiceChannel.members.filter(member => !member.user.bot); // Exclude bots
                        
                        await awardPointsToVCMembers(voiceChannel, points, textChannel);

                        // Send completion message to text channel
                        const embedDone = new EmbedBuilder()
                            .setTitle('Well Done!')
                            .setDescription(`You've studied for ${session.duration} minutes!`)
                            .setColor(0x2ECC71); // Green for success
                        await textChannel.send({ embeds: [embedDone] });

                        // Create a list of users and the points they earned
                        let fields = [];
                        members.forEach(member => {
                            fields.push({
                                name: `${member.user.username}`,
                                value: `${points} points`,
                                inline: true // Display them in rows
                            });
                        });
    
                        const pointsEmbed = new EmbedBuilder()
                            .setTitle('Study Points Earned!')
                            .setDescription('Here are the points earned by each member:')
                            .setColor(0x9B59B6) // Purple for info
                            .addFields(fields); // Add the fields with users and points
                        await textChannel.send({ embeds: [pointsEmbed] }).catch(console.error);
    
                        // Clean up the session after sending the message
                        sessions.delete(sessionCode);
                    }
                }, duration * 60 * 1000); // Convert minutes to milliseconds
            }
        }
        catch (err) {
            console.error("Error at Start: " + err);
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Session Start Error ⚠️')
                .setDescription(`There was an error starting your session. Try again in 5 mins for a break `)
                .setColor(0x2ECC71) // Green for success
                .addFields([
                    { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                    { name: 'Time', value: `${duration} minutes`, inline: true },
                    { name: 'Session Code', value: sessionCode, inline: true }
                ]);
    
            await interaction.editReply({ embeds: [embed] });
        }
    } 
    
    // //

    else if (commandName === 'status') {
        logEvent(serverId, 'Check Session Status Command Run', 'medium');

        const sessionCode = interaction.options.getString('code').toUpperCase();

        const server = await Server.findOne({ where: { serverId: interaction.guild.id } });

        if (server && server.textChannelId !== interaction.channelId) {
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C) // Red for error
                .setTitle('Invalid Channel')
                .setDescription('This command can only be used in the designated study session channel')
                .addFields({
                    name: 'Study Session Channel',
                    value: `<#${server.textChannelId}>`
                })
            return await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

        if (!sessions.has(sessionCode)) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Code')
                .setDescription(`No active study session found with the code: ${sessionCode}.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const session = sessions.get(sessionCode);
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);

        if (!voiceChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`The voice channel for session code ${sessionCode} could not be found.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Calculate remaining time
        const elapsedMinutes = Math.floor((Date.now() - session.startTime) / 1000 / 60);

        // Keep incase of error
        // const actualDuration = Math.min(session.duration, elapsedMinutes);
        // await awardPointsToVCMembers(voiceChannel, actualDuration);

        const remainingTime = Math.max(0, session.duration - elapsedMinutes);

        const embed = new EmbedBuilder()
            .setTitle('Study Session Status')
            .setDescription(`Status for session code: ${sessionCode}`)
            .setColor(0x3498DB) // Blue for info
            .addFields([
                { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                { name: 'Remaining Time', value: `${remainingTime} minutes`, inline: true },
                { name: 'Members in VC', value: `${voiceChannel.members.size}`, inline: true }
            ]);
        await interaction.reply({ embeds: [embed], ephemeral: true });

    } 
    
    // //

    else if (commandName === 'stop') {
        logEvent(serverId, 'Stop Session Command Run', 'medium');
        console.log("Stop command triggered");

        await interaction.deferReply();

        const server = await Server.findOne({ where: { serverId: interaction.guild.id } });

        if (server?.textChannelId !== interaction.channelId) {
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C) // Red for error
                .setTitle('Invalid Channel')
                .setDescription('This command can only be used in the designated study session channel')
                .addFields({
                    name: 'Study Session Channel',
                    value: `<#${server.textChannelId}>`
                })

            return await interaction.editReply({ embeds: [embed], ephemeral: true });
        }
    
        const user = interaction.user;
        const sessionCodeInput = interaction.options.getString('code').toUpperCase();
    
        if (!sessions.has(sessionCodeInput)) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Code')
                .setDescription(`No active study session found with the code: ${sessionCodeInput}.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }
    
        const session = sessions.get(sessionCodeInput);
    
        // Check if the user is the host
        if (session.userId !== user.id) {
            const embed = new EmbedBuilder()
                .setTitle('Permission Denied')
                .setDescription('Only the host can stop the session.')
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }
    
        // Calculate actual time spent in the session (in minutes)
        const currentTime = Date.now();
        const actualTimeSpent = Math.floor((currentTime - session.startTime) / 1000 / 60); // Time in minutes
        const timeStudied = Math.min(actualTimeSpent, session.duration); // Cap at session duration
    
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);
        voiceChannel.setName("Study Completed").catch(console.error); // Rename channel
    
        const embedStop = new EmbedBuilder()
            .setTitle('Study Session Stopped')
            .setDescription(`The session with code ${sessionCodeInput} has been stopped. You studied for ${timeStudied} minutes.`)
            .setColor(0xE74C3C); // Red for stopped session
        await interaction.editReply({ embeds: [embedStop] });
    
        // Award points based on actual time spent
        console.log("On Stop Command: Award Points To VC Members: " + timeStudied + " minutes");
        await awardPointsToVCMembers(voiceChannel, timeStudied);
    
        sessions.delete(sessionCodeInput); // Remove the session
    } 
    
    // //
    
    else if (commandName === 'leaderboard') {
        logEvent(serverId, 'Leaderboard Command Run', 'high');

        await interaction.deferReply();

        const leaderboardData = await getLeaderboard(interaction.guild.id);

        const server = await Server.findOne({ where: { serverId: interaction.guild.id } });

        if (server && server.textChannelId !== interaction.channelId) {
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C) // Red for error
                .setTitle('Invalid Channel')
                .setDescription('This command can only be used in the designated study session channel')
                .addFields({
                    name: 'Study Session Channel',
                    value: `<#${server.textChannelId}>`
                })
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (leaderboardData && leaderboardData.length > 0) {
            const embed = new EmbedBuilder()
                .setTitle('Study Leaderboard')
                .setDescription(leaderboardData.join('\n'))
                .setColor(0x9B59B6); // Purple for leaderboard
            interaction.editReply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Leaderboard')
                .setDescription('No data available.')
                .setColor(0xE74C3C); // Red for error
            interaction.editReply({ embeds: [embed] });
        }
        
    } 
    
    // //

    else if (commandName === 'settextchannel') {
        logEvent(serverId, 'Set Text Channel Command Run', 'low');

        const channel = options.getChannel('channel');

        let server = await Server.findOne({ where: { serverId: interaction.guild.id } });

        // Find or create the server record in the database
        if (!server) {
            server = await Server.create({ serverId: guildId });
        }

        // Update the text channel ID in the database
        server.textChannelId = channel.id;
        await server.save();

        await interaction.reply(`Text channel has been set to ${channel}.`);
    } 
    
    // //
    
    else if (commandName === 'setloggingchannel') {
        logEvent(serverId, 'Set Logging Channel Command Run', 'low');

        const channel = options.getChannel('channel');

        // Find or create the server record in the database
        let server = await Server.findOne({ where: { serverId: guildId } });
        if (!server) {
            server = await Server.create({ serverId: guildId });
        }

        // Update the logging channel ID in the database
        server.loggingChannelId = channel.id;
        await server.save();

        await interaction.reply(`Logging channel has been set to ${channel}.`);
    }

    // //

    else if (interaction.commandName === 'setloglevel') {
        logEvent(serverId, 'Set Log Level Command Run', 'low');

        const level = interaction.options.getString('level');

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'You need to be an admin to run this command.', ephemeral: true });
        }

        let server = await Server.findOne({ where: { serverId: interaction.guild.id } });
        if (!server) {
            return interaction.reply({ content: 'Server not found in the database.', ephemeral: true });
        }

        server.logLevel = level;
        await server.save();

        await interaction.reply({ content: `Log level set to ${level}`, ephemeral: true });
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

client.login(process.env.TEST_TOKEN);
