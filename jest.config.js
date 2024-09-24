module.exports = {
    preset: 'jest-preset-default',
    testEnvironment: 'node',
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: 'J:/Documents/Discord JS Code/Study Bot',
    testRegex: '.*\\.test\\.js$',
    transform: {
        '^.+\\.(t|j)s$': 'jest-preset-default',
    },
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: 'coverage',
};

// module.exports = {
//     moduleNameMapper: {
//         '^discord.js$': '<rootDir>/__mocks__/discord.js',
//     },
// };