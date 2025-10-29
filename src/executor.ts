import { spawn } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { readConfig, getCredential, getApiKey } from './storage.js';
import type { Profile } from './types.js';

/**
 * Sanitize environment variables - remove all ANTHROPIC_* vars
 */
export function sanitizeEnvironment(): Record<string, string> {
  const clean: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('ANTHROPIC_')) {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Prepare environment for a profile
 * Always use ANTHROPIC_AUTH_TOKEN for credentials
 * Always set ANTHROPIC_API_KEY (even if empty)
 */
export async function prepareEnvironment(
  profile: Profile,
  credential: string,
  apiKey: string
): Promise<Record<string, string>> {
  const env = sanitizeEnvironment();

  // Always use ANTHROPIC_AUTH_TOKEN
  env['ANTHROPIC_AUTH_TOKEN'] = credential;

  // Always set ANTHROPIC_API_KEY (even if empty)
  env['ANTHROPIC_API_KEY'] = apiKey;

  // Set base URL if not default Anthropic
  if (profile.baseUrl !== 'https://api.anthropic.com') {
    env['ANTHROPIC_BASE_URL'] = profile.baseUrl;
  }

  return env;
}

/**
 * Execute claude command with profile
 */
export async function executeWithProfile(
  profileName: string | undefined,
  args: string[]
): Promise<void> {
  const config = readConfig();

  // Determine which profile to use
  let targetProfile: Profile | undefined;

  if (profileName) {
    // Profile specified in command line
    targetProfile = config.profiles.find((p) => p.name === profileName);
    if (!targetProfile) {
      console.error(chalk.red(`Profile "${profileName}" not found.`));
      console.log(chalk.yellow('Run "ai-claude-start list" to see available profiles.'));
      process.exit(1);
    }
  } else {
    // No profile specified, show interactive selection
    if (config.profiles.length === 0) {
      console.error(chalk.red('No profiles configured.'));
      console.log(chalk.yellow('Run "ai-claude-start setup" to create a profile.'));
      process.exit(1);
    }

    if (config.profiles.length === 1) {
      // Only one profile, use it automatically
      targetProfile = config.profiles[0];
      console.log(chalk.blue(`Using profile: ${chalk.bold(targetProfile.name)}`));
    } else {
      // Multiple profiles, show selection menu
      const { selectedProfile } = await inquirer.prompt<{ selectedProfile: string }>([
        {
          type: 'list',
          name: 'selectedProfile',
          message: 'Select a profile to use:',
          choices: config.profiles.map((p) => ({
            name: p.name === config.defaultProfile
              ? `${p.name} ${chalk.green('(default)')}`
              : p.name,
            value: p.name
          })),
          default: config.defaultProfile
        }
      ]);

      targetProfile = config.profiles.find((p) => p.name === selectedProfile);
      if (!targetProfile) {
        console.error(chalk.red(`Profile "${selectedProfile}" not found.`));
        process.exit(1);
      }
    }
  }

  // Get credential
  const credential = await getCredential(targetProfile.name);
  if (!credential) {
    console.error(
      chalk.red(`No credential found for profile "${targetProfile.name}".`)
    );
    console.log(chalk.yellow('Run "ai-claude-start setup" to configure credentials.'));
    process.exit(1);
  }

  // Get API key (optional, defaults to empty string)
  const apiKey = await getApiKey(targetProfile.name) || '';

  // Prepare environment
  const env = await prepareEnvironment(targetProfile, credential, apiKey);

  // Determine command to run
  const cmdBinary = process.env.CLAUDE_CMD || args.find((arg) => arg === '--cmd')
    ? args[args.indexOf('--cmd') + 1]
    : 'claude';

  // Filter out --cmd and its value from args
  let claudeArgs = args;
  const cmdIndex = args.indexOf('--cmd');
  if (cmdIndex >= 0) {
    claudeArgs = [...args.slice(0, cmdIndex), ...args.slice(cmdIndex + 2)];
  }

  // Add --model parameter if profile has model configured and not already specified
  if (targetProfile.model && !claudeArgs.includes('--model')) {
    claudeArgs = ['--model', targetProfile.model, ...claudeArgs];
  }

  // Add --dangerously-skip-permissions parameter if not already specified
  if (!claudeArgs.includes('--dangerously-skip-permissions')) {
    claudeArgs = ['--dangerously-skip-permissions', ...claudeArgs];
  }

  console.log(
    chalk.blue(`🚀 Launching with profile: ${chalk.bold(targetProfile.name)}`)
  );
  if (targetProfile.model) {
    console.log(chalk.blue(`   Model: ${targetProfile.model}`));
  }

  // Execute
  const child = spawn(cmdBinary, claudeArgs, {
    env,
    stdio: 'inherit',
    shell: true
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (error) => {
    console.error(chalk.red(`Failed to execute command: ${error.message}`));
    process.exit(1);
  });
}
