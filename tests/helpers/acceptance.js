'use strict';

var symlinkOrCopySync = require('symlink-or-copy').sync;
var path              = require('path');
var fs                = require('fs-extra');
var runCommand        = require('./run-command');
var Promise           = require('../../lib/ext/promise');
var tmp               = require('./tmp');
var existsSync        = require('exists-sync');
var copy              = Promise.denodeify(fs.copy);
var exec              = Promise.denodeify(require('child_process').exec);
var root = path.resolve(__dirname, '..', '..');

var runCommandOptions = {
  // Note: We must override the default logOnFailure logging, because we are
  // not inside a test.
  log: function() {
    return; // no output for initial application build
  }
};

function handleResult(result) {
  if (result.output) { console.log(result.output.join('\n')); }
  if (result.errors) { console.log(result.errors.join('\n')); }
  throw result;
}

function downloaded(item) {
  var exists = false;
  switch (item) {
    case 'node_modules':
      exists = existsSync(path.join(root, '.deps-tmp', 'node_modules'));
      break;
    case 'bower_components':
      exists = existsSync(path.join(root, '.deps-tmp', 'bower_components'));
      break;
  }

  return exists;
}

function mvRm(from, to) {
  var dir = path.join(root, to);
  from = path.resolve(from);

  if (!existsSync(dir)) {
    fs.mkdirsSync(dir);
    fs.copySync(from, to);
    fs.removeSync(from);
  }
}

function symLinkDir(projectPath, from, to) {
  symlinkOrCopySync(path.resolve(root, from), path.resolve(projectPath, to));
}

function applyCommand(command, name /*, ...flags*/) {
  var flags = [].slice.call(arguments, 2, arguments.length);
  var args = [path.join('..', 'bin', 'ember'), command, '--disable-analytics', '--watcher=node', '--skip-git', name, runCommandOptions];

  flags.forEach(function(flag) {
    args.splice(2, 0, flag);
  });

  return runCommand.apply(undefined, args);
}

function createTmp(command) {
  var targetPath = path.join(root, 'common-tmp');
  return tmp.setup(targetPath).then(function() {
    process.chdir(targetPath);
    return command();
  });
}

/**
 * Use `createTestTargets` in the before hook to do the initial
 * setup of a project. This will ensure that we limit the amount of times
 * we go to the network to fetch dependencies.
 * @param  {String} projectName The name of the project. Can be an app or addon.
 * @param  {Object} options
 * @property {String} options.command The command you want to run
 * @return {Promise}  The result of the running the command
 */
function createTestTargets(projectName, options) {
  var command;
  options = options || {};
  options.command = options.command || 'new';

  var noNodeModules = !downloaded('node_modules');
  // Fresh install
  if (noNodeModules && !downloaded('bower_components')) {
    command = function() {
      return applyCommand(options.command, projectName);
    };
    // bower_components but no node_modules
  } else if (noNodeModules && downloaded('bower_components')) {
    command = function() {
      return applyCommand(options.command, projectName, '--skip-bower');
    };
    // node_modules but no bower_components
  } else if (!downloaded('bower_components') && downloaded('node_modules')) {
    command = function() {
      return applyCommand(options.command, projectName, '--skip-npm');
    };
  } else {
    // Everything is already there
    command = function() {
      return applyCommand(options.command, projectName, '--skip-npm', '--skip-bower');
    };
  }

  return createTmp(function() {
    return command().catch(handleResult).then(function(value) {
      if (noNodeModules) {
        return exec('npm install ember-disable-prototype-extensions').then(function() {
          return value;
        });
      }

      return value;
    });
  });
}

/**
 * Tears down the targeted project download directory
 * @return {Promise}
 */
function teardownTestTargets() {
  return tmp.teardown(path.join(root, 'common-tmp'));
}

/**
 * Creates symbolic links from the dependency temp directories
 * to the project that is under test.
 * @param  {String} projectName The name of the project under test
 * @return {Promise}
 */
function linkDependencies(projectName) {
  var targetPath = path.join(root, 'tmp', projectName);
  return tmp.setup(targetPath).then(function() {
    return copy(path.join(root, 'common-tmp', projectName), targetPath);
  }).then(function() {
    var nodeModulesPath = path.join(targetPath, 'node_modules');

    mvRm(nodeModulesPath, path.join(root, '.deps-tmp', 'node_modules'));

    if (!existsSync(nodeModulesPath)) {
      symLinkDir(targetPath, path.join(root, '.deps-tmp', 'node_modules'), 'node_modules');
    }

    process.chdir(targetPath);

    var appsECLIPath = path.join('node_modules', 'ember-cli');
    fs.removeSync(appsECLIPath);

    // Need to junction on windows since we likely don't have persmission to symlink
    // 3rd arg is ignored on systems other than windows
    fs.symlinkSync(path.resolve('../..'), appsECLIPath, 'junction');

    return targetPath;
  });
}

/**
 * Clean a test run and optionally assert.
 * @return {Promise}
 */
function cleanupRun(projectName) {
  var targetPath = path.join(root, 'tmp', projectName);
  return tmp.teardown(targetPath);
}

module.exports = {
  createTestTargets: createTestTargets,
  linkDependencies: linkDependencies,
  teardownTestTargets: teardownTestTargets,
  cleanupRun: cleanupRun
};
