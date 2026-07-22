export default {
    displayName: 'auth-js',
    preset: '../../jest.preset.js',
    testEnvironment: 'jsdom',
    transform: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    moduleNameMapper: {
        // lodash-es is ESM-only; map to the CJS twin so jest doesn't need to transform it
        '^lodash-es$': 'lodash',
        // mirror the workspace tsconfig path aliases (self-references inside the lib)
        '^@empeon/auth-js$': '<rootDir>/core',
        '^@empeon/auth-js/oidc$': '<rootDir>/oidc',
    },
    coverageDirectory: '../../coverage/libs/auth-js',
};
