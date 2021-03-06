'use strict';

var Promise    = require('../../lib/ext/promise');
var path       = require('path');
var fs         = require('fs-extra');
var remove     = Promise.denodeify(fs.remove);
var spawn      = require('child_process').spawn;
var chalk      = require('chalk');

var symlinkOrCopySync   = require('symlink-or-copy').sync;
var runCommand          = require('../helpers/run-command');
var ember               = require('../helpers/ember');
var copyFixtureFiles    = require('../helpers/copy-fixture-files');
var killCliProcess      = require('../helpers/kill-cli-process');
var acceptance          = require('../helpers/acceptance');
var createTestTargets   = acceptance.createTestTargets;
var teardownTestTargets = acceptance.teardownTestTargets;
var linkDependencies    = acceptance.linkDependencies;
var cleanupRun          = acceptance.cleanupRun;

var chai = require('../chai');
var expect = chai.expect;
var dir = chai.dir;

var addonName = 'some-cool-addon';
var addonRoot;

describe('Acceptance: addon-smoke-test', function() {
  this.timeout(450000);

  before(function() {
    return createTestTargets(addonName, {
      command: 'addon'
    });
  });

  after(function() {
    return teardownTestTargets();
  });

  beforeEach(function() {
    return linkDependencies(addonName).then(function(result) {
      addonRoot = result;
    });
  });

  afterEach(function() {
    // Cleans up a folder set up on the other side of a symlink.
    fs.remove(path.join(addonRoot, 'node_modules', 'developing-addon'));

    return cleanupRun(addonName).then(function() {
      expect(dir(addonRoot)).to.not.exist;
    });
  });

  it('generates package.json and bower.json with proper metadata', function() {
    var packageContents = fs.readJsonSync('package.json');

    expect(packageContents.name).to.equal(addonName);
    expect(packageContents.private).to.be.an('undefined');
    expect(packageContents.keywords).to.deep.equal([ 'ember-addon' ]);
    expect(packageContents['ember-addon']).to.deep.equal({ 'configPath': 'tests/dummy/config' });

    var bowerContents = fs.readJsonSync('bower.json');

    expect(bowerContents.name).to.equal(addonName);
  });

  it('ember addon foo, clean from scratch', function() {
    return ember(['test']);
  });

  it('works in most common scenarios for an example addon', function() {
    return copyFixtureFiles('addon/kitchen-sink').then(function() {
      var packageJsonPath = path.join(addonRoot, 'package.json');
      var packageJson = fs.readJsonSync(packageJsonPath);

      packageJson.dependencies = packageJson.dependencies || {};
      // add HTMLBars for templates (generators do this automatically when components/templates are added)
      packageJson.dependencies['ember-cli-htmlbars'] = 'latest';

      // build with addon deps being developed
      packageJson.dependencies['developing-addon'] = 'latest';

      fs.writeJsonSync(packageJsonPath, packageJson);

      symlinkOrCopySync(path.resolve('../../tests/fixtures/addon/developing-addon'), path.join(addonRoot, 'node_modules', 'developing-addon'));

      return runCommand('node_modules/ember-cli/bin/ember', 'build').then(function(result) {
        expect(result.code).to.eql(0);
        var contents;

        var indexPath = path.join(addonRoot, 'dist', 'index.html');
        contents = fs.readFileSync(indexPath, { encoding: 'utf8' });
        expect(contents).to.contain('"SOME AWESOME STUFF"');

        var cssPath = path.join(addonRoot, 'dist', 'assets', 'vendor.css');
        contents = fs.readFileSync(cssPath, { encoding: 'utf8' });
        expect(contents).to.contain('addon/styles/app.css is present');

        var robotsPath = path.join(addonRoot, 'dist', 'robots.txt');
        contents = fs.readFileSync(robotsPath, { encoding: 'utf8' });
        expect(contents).to.contain('tests/dummy/public/robots.txt is present');

        return runCommand('node_modules/ember-cli/bin/ember', 'test').then(function(result) {
          expect(result.code).to.eql(0);
        });
      });
    });
  });

  it('npm pack does not include unnecessary files', function() {
    var handleError = function(error, commandName) {
      if (error.code === 'ENOENT') {
        console.warn(chalk.yellow('      Your system does not provide ' + commandName + ' -> Skipped this test.'));
      } else {
        throw new Error(error);
      }
    };

    return new Promise(function(resolve, reject) {
      var npmPack = spawn('npm', ['pack']);
      npmPack.on('error', function(error) {
        reject(error);
      });
      npmPack.on('close', function() {
        resolve();
      });
    }).then(function() {
      return new Promise(function(resolve, reject) {
        var output;
        var tar = spawn('tar', ['-tf', addonName + '-0.0.0.tgz']);
        tar.on('error', function(error) {
          reject(error);
        });
        tar.stdout.on('data', function(data) {
          output = data.toString();
        });
        tar.on('close', function() {
          resolve(output);
        });
      }).then(function(output) {
        var unnecessaryFiles = [
          '.gitkeep',
          '.travis.yml',
          '.editorconfig',
          'testem.js',
          '.ember-cli',
          'bower.json',
          '.bowerrc'
        ];

        var unnecessaryFolders = [
          'tests/',
          'bower_components/'
        ];

        var outputFiles = output.split('\n');
        expect(outputFiles).to.not.contain(unnecessaryFiles);
        expect(outputFiles).to.not.contain(unnecessaryFolders);
      }, function(error) {
        handleError(error, 'tar');
      });
    }, function(error) {
      handleError(error, 'npm');
    });
  });
});
