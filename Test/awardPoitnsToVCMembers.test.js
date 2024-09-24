// awardPointsToVCMembers.test.js
const { awardPointsToVCMembers } = require("../commands/utils.js");
const { VoiceChannel } = require("discord.js");

jest.mock("discord.js", () => ({
    VoiceChannel: jest.fn().mockImplementation(() => ({
        members: {
            size: 5,
            forEach: jest.fn(),
        },
    })),
}));

describe("awardPointsToVCMembers", () => {
    it("should award points to VC members", async () => {
        const voiceChannel = new VoiceChannel();
        const points = 10;

        await awardPointsToVCMembers(voiceChannel, points);

        expect(voiceChannel.members.forEach).toHaveBeenCalledTimes(1);
        expect(voiceChannel.members.forEach).toHaveBeenCalledWith(
            expect.any(Function)
        );
    });

    it("should handle errors", async () => {
        const voiceChannel = new VoiceChannel();
        const points = 10;

        jest.spyOn(voiceChannel.members, "forEach").mockImplementationOnce(() => {
            throw new Error("Mock error");
        });

        try {
            await awardPointsToVCMembers(voiceChannel, points);
        } catch (error) {
            expect(error.message).toBe("Mock error");
        }
    });
});
