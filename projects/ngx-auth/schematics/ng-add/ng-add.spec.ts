import { Tree } from '@angular-devkit/schematics';
import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { disable as disableColors } from '@colors/colors';
import { ApplicationDefinition, getProjectFromWorkspace } from '@hug/ngx-schematics-utilities';
import { describe, expect, it } from '@jest/globals';

import { appTest1, appTest2, getCleanAppTree, runner } from '../utils';
import { MODULE_CONTENT, STANDALONE_CONTENT } from './index';
import { NgAddOptions } from './ng-add-options';

interface Log {
    name: string;
    level: string;
    message: string;
}

const occurrences = (str: string, pattern: string): number => (str.match(new RegExp(pattern, 'g')) ?? []).length;

const eoc = expect.objectContaining.bind(this);
const eac = expect.arrayContaining.bind(this);

[false, true].forEach(useStandalone => {
    [false, true].forEach(useWorkspace => {
        describe(`schematics - ng-add - (using${useStandalone ? ' standalone' : ''}${useWorkspace ? ' workspace' : ' flat'} project)`, () => {
            let defaultOptions: NgAddOptions;
            let tree: UnitTestTree;
            let nbFiles: number;
            let logs: Log[];
            let project: ApplicationDefinition;

            beforeAll(() => {
                disableColors();
                runner.logger.subscribe(log => logs.push(log));
            });

            beforeEach(async () => {
                tree = await getCleanAppTree(useWorkspace, useStandalone);
                nbFiles = tree.files.length;
                logs = [];
                defaultOptions = {
                    project: (useWorkspace) ? appTest2.name : appTest1.name,
                    authorityUrl: 'https://dev-fijd1e9x.us.auth0.com',
                    clientId: 'kRVVEnAWKMpxxpcodl0TqLXfIHgQvmmt'
                } as NgAddOptions;
                project = await getProjectFromWorkspace(tree, defaultOptions.project);
            });

            it('should failed without an angular app', async () => {
                const tree$ = runner.runSchematic('ng-add', defaultOptions, Tree.empty());
                await expect(tree$).rejects.toMatchObject({
                    message: 'Unable to locate a workspace file, are you missing an `angular.json` or `.angular.json` file ?.'
                });
            });

            it('should run without errors', async () => {
                const tree$ = runner.runSchematic('ng-add', defaultOptions, tree);
                await expect(tree$).resolves.not.toThrow();
            });

            it('should not create any new files', async () => {
                tree = await runner.runSchematic('ng-add', defaultOptions, tree);
                expect(tree.files.length).toEqual(nbFiles);
            });

            it('should update angular.json', async () => {
                await runner.runSchematic('ng-add', defaultOptions, tree);
                const angularJson = tree.readJson('angular.json');
                const asset = {
                    glob: '**/*',
                    input: 'node_modules/@badisi/ngx-auth/oidc/assets',
                    output: 'oidc/callback'
                };
                expect(angularJson).toEqual(eoc({
                    projects: eoc({
                        [project.name]: eoc({
                            architect: eoc({
                                build: eoc({
                                    options: eoc({
                                        allowedCommonJsDependencies: eac([
                                            'crypto-js'
                                        ]),
                                        assets: eac([asset])
                                    })
                                }),
                                test: eoc({
                                    options: eoc({
                                        assets: eac([asset])
                                    })
                                })
                            })
                        })
                    })
                }));
            });

            it('should update main.ts', async () => {
                await runner.runSchematic('ng-add', defaultOptions, tree);
                const mainTsContent = tree.readContent(project.pathFromSourceRoot('main.ts'));
                if (useStandalone) {
                    expect(mainTsContent).toContain('import { initAuth, provideAuth } from \'@badisi/ngx-auth\';');
                    expect(mainTsContent).toContain(STANDALONE_CONTENT);
                    expect(mainTsContent).not.toContain(MODULE_CONTENT);
                } else {
                    expect(mainTsContent).toContain('import { initAuth } from \'@badisi/ngx-auth\';');
                    expect(mainTsContent).toContain(MODULE_CONTENT);
                    expect(mainTsContent).not.toContain(STANDALONE_CONTENT);
                    expect(mainTsContent).not.toContain('provideAuth');
                }
            });

            it('should update app.module.ts', async () => {
                await runner.runSchematic('ng-add', defaultOptions, tree);
                const appModuleContent = tree.readContent(project.pathFromSourceRoot('app/app.module.ts'));
                if (useStandalone) {
                    expect(appModuleContent).not.toContain('import { AuthModule } from \'@badisi/ngx-auth\'');
                    expect(appModuleContent).not.toMatch(/@NgModule\({.*imports.*AuthModule/gms);
                } else {
                    expect(appModuleContent).toContain('import { AuthModule } from \'@badisi/ngx-auth\'');
                    expect(appModuleContent).toMatch(/@NgModule\({.*imports.*AuthModule/gms);
                }
            });

            it('should not create duplicates when running twice', async () => {
                tree = await runner.runSchematic('ng-add', defaultOptions, tree);
                tree = await runner.runSchematic('ng-add', defaultOptions, tree);

                const angularJsonPath = 'angular.json';
                const angularJsonContent = tree.read(angularJsonPath)?.toString('utf-8') ?? '';
                expect(occurrences(angularJsonContent, 'crypto-js')).toEqual(1);
                expect(occurrences(angularJsonContent, 'node_modules/@badisi/ngx-auth/oidc/assets')).toEqual(2);

                const mainTsPath = project.pathFromSourceRoot('main.ts');
                const mainTsContent = tree.read(mainTsPath)?.toString('utf-8') ?? '';
                expect(occurrences(mainTsContent, '@badisi/ngx-auth')).toEqual(1);
                expect(occurrences(mainTsContent, 'initAuth')).toEqual(2);
                expect(occurrences(mainTsContent, 'provideAuth')).toEqual(useStandalone ? 2 : 0);

                const appModuleTsPath = project.pathFromSourceRoot('app/app.module.ts');
                const appModuleTsContent = tree.read(appModuleTsPath)?.toString('utf-8') ?? '';
                expect(occurrences(appModuleTsContent, '@badisi/ngx-auth')).toEqual(useStandalone ? 0 : 1);
                expect(occurrences(appModuleTsContent, 'AuthModule')).toEqual(useStandalone ? 0 : 2);
            });

            it('should display an action message', async () => {
                tree = await runner.runSchematic('ng-add', defaultOptions, tree);
                expect(logs).toContainEqual(expect.objectContaining({
                    name: 'ng-add',
                    level: 'info',
                    message: expect.stringMatching(/.*ACTION.*Have a look at main.ts file and update the auth configuration according to your needs\..*/)
                }));
            });

            it('should display an error message', async () => {
                const originalMainTsContent = tree.read(project.mainFilePath)?.toString('utf-8') ?? '';

                tree = await runner.runSchematic('ng-add', defaultOptions, tree);
                expect(logs).not.toContainEqual(expect.objectContaining({
                    name: 'ng-add',
                    level: 'info',
                    message: expect.stringMatching(/.*ERROR.*There were some conflicts during the installation, please have a look at main.ts file and resolve them\..*/)
                }));

                if (useStandalone) {
                    tree.overwrite(project.mainFilePath, originalMainTsContent.replace('bootstrapApplication', 'bootstrapApplicationERROR'));
                } else {
                    tree.overwrite(project.mainFilePath, originalMainTsContent.replace('bootstrapModule', 'bootstrapModuleERROR'));
                }

                tree = await runner.runSchematic('ng-add', defaultOptions, tree);
                expect(logs).toContainEqual(expect.objectContaining({
                    name: 'ng-add',
                    level: 'info',
                    message: expect.stringMatching(/.*ERROR.*There were some conflicts during the installation, please have a look at main.ts file and resolve them\..*/)
                }));
            });
        });
    });
});