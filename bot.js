const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType, EmbedBuilder, ChannelType } = require('discord.js');
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
        handleSessionReactions
        } = require('./commands/utils.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const rest = new REST({ version: '10' }).setToken(process.env.TEST_TOKEN);

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

    // Slash command to set the logging channel
    new SlashCommandBuilder()
    .setName('setloggingchannel')
    .setDescription('Set the logging channel for updates.')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Select the logging channel for updates')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
    ),
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

    // Fetch all guilds (servers) the bot is in
    const guilds = await client.guilds.fetch();

    // Loop over each guild and ensure it's in the database
    for (const [guildId, guild] of guilds) {
        try {
            // Check if the server exists in the database
            let server = await Server.findOne({ where: { serverId: guildId } });
            
            if (!server) {
                // If not, create a new entry for the server
                server = await Server.create({
                    serverId: guildId
                });
                console.log(`Added server ${guild.name} (${guildId}) to the database.`);
            } else {
                console.log(`Server ${guild.name} (${guildId}) already exists in the database.`);
            }
        } catch (error) {
            console.error(`Error adding server ${guild.name} (${guildId}) to the database:`, error);
        }
    }

    try {
        const guilds = await client.guilds.fetch();
        guilds.forEach(async (guild) => {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: commands }
                );
            } catch (error) {
                console.error(`Error registering commands for guild: ${guild.id}`, error);
            }
        });
        console.log('Successfully registered application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    console.log('All servers initialized in the database.');
});

let sessions = new Map(); // Store active study sessions
let prompts = new Map(); // Store ongoing prompts when the host leaves

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    if (!interaction.isCommand()) return;
    const { commandName, options, guildId } = interaction;

    if (commandName === 'stats') {
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
            await interaction.editReply({ embeds: [embed] });
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
                const sessionCode = generateSessionCode();
        
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
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
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
        await interaction.deferReply();

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
        await voiceChannel.setName("Study Completed").catch(console.error); // Rename channel
    
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
});


// Monitor voice state updates to detect when the host leaves
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Check if a user left the voice channel
    if (!oldState.channelId && newState.channelId) {
        const joinTime = new Date();
        await addUserSession(newState.member.id, newState.channel.id, joinTime, newState.guild.id);
    }

    // When user leaves a voice channel
    if (oldState.channelId && !newState.channelId) {
        const leaveTime = new Date();
        
        // Calculate session-specific duration
        const sessionDuration = await endUserSession(oldState.member.id, oldState.channel.id, leaveTime, oldState.guild.id);

        if (sessionDuration > 0) {
            // Calculate points based on the session duration (1 point per minute)
            const points = Math.floor(sessionDuration / 60000); // Convert milliseconds to minutes
            console.log("Awarding points based on session duration:", points);

            // Award points to the user
            await awardPointsToUser(oldState.member.id, oldState.guild.id, points);
        }
    }

    // Find if the user was a host of any session
    const session = [...sessions.values()].find(s => s.userId === oldState.member.id && s.voiceChannelId === oldState.channelId);
    if (!session) return;

    const server = await Server.findOne({ where: { serverId: oldState.guild.id } });
    if (!server?.textChannelId) {
        console.error("No dedicated text channel set for this server.");
        return;
    }


    const voiceChannel = await client.channels.fetch(session.voiceChannelId);
    const textChannel = oldState.guild.channels.cache.get(server.textChannelId);

    if (!textChannel) {
        console.error("Bot does not have permission to send messages in the configured text channel.");
        return;
    }

    if (voiceChannel.members.size === 0) {
        // No one is left in the channel, automatically end the session
        await voiceChannel.setName(session.voiceChannelName).catch(console.error);
        sessions.delete(session.sessionCode);
        
        const embedStop = new EmbedBuilder()
            .setTitle('Session Ended')
            .setDescription('The session has ended as no one is left in the voice channel.')
            .setColor(0xE74C3C); // Red for stop
        await textChannel.send({ embeds: [embedStop] });
        
        console.log("When members in VC = 0: Award Points to VC Members");
        await awardPointsToVCMembers(voiceChannel, session.duration);
    } else {
        // Send the prompt in the text channel and move reaction handling elsewhere
        const embedPrompt = new EmbedBuilder()
            .setTitle('Host Left')
            .setDescription(`The host has left. React with ✅ to continue or ❌ to end the session. The session will end in 1 minute if no one responds.`)
            .setColor(0xF1C40F); // Yellow for prompt
    
        try {
            const message = await textChannel.send({ embeds: [embedPrompt] });
            await message.react('✅');
            await message.react('❌');

            const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
            const collector = message.createReactionCollector({ filter, time: 60000 });

            collector.on('collect', async (reaction) => {
                if (reaction.emoji.name === '✅') {
                    const embedContinue = new EmbedBuilder()
                        .setTitle('Session Continued')
                        .setDescription('The session will continue!')
                        .setColor(0x2ECC71); // Green for success
                    await textChannel.send({ embeds: [embedContinue] });
                } else if (reaction.emoji.name === '❌') {
                    await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                    sessions.delete(session.sessionCode);
                    console.log("Collectior on Collect Host Left: Award Points to VC Members");
                    await awardPointsToVCMembers(voiceChannel, session.duration, textChannel);
                    const embedStop = new EmbedBuilder()
                        .setTitle('Session Ended')
                        .setDescription('The session has ended.')
                        .setColor(0xE74C3C); // Red for stop
                    await textChannel.send({ embeds: [embedStop] });
                }
                collector.stop();
            });

            collector.on('end', async () => {
                if (!collector.collected.size) {
                    await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                    sessions.delete(session.sessionCode);
                    console.log("Collectior on End: Award Points to VC Members");
                    await awardPointsToVCMembers(voiceChannel, session.duration, textChannel);
                    const embedStop = new EmbedBuilder()
                        .setTitle('Session Ended')
                        .setDescription('No response was received. The session has ended.')
                        .setColor(0xE74C3C); // Red for stop
                    await textChannel.send({ embeds: [embedStop] });
                }
            });
        } catch (error) {
            console.error("Failed to send message or handle reactions:", error);
        }
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

client.login(process.env.TEST_TOKEN);
