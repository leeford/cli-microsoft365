const omelette: (template: string) => Omelette = require('omelette');
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

class Autocomplete {
  private static autocompleteFilePath: string = path.join(__dirname, `..${path.sep}commands.json`);
  private omelette: Omelette;
  private commands: any = {};

  constructor() {
    this.init();
  }

  private init(): void {
    if (fs.existsSync(Autocomplete.autocompleteFilePath)) {
      try {
        const data: string = fs.readFileSync(Autocomplete.autocompleteFilePath, 'utf-8');
        this.commands = JSON.parse(data);
      }
      catch { }
    }

    const _this = this;

    function handleAutocomplete(this: any, fragment: string, data: any): void {
      let replies: Object | string[] = {};
      let allWords: string[] = [];

      if (data.fragment === 1) {
        replies = Object.keys(_this.commands);
      }
      else {
        allWords = data.line.split(/\s+/).slice(1, -1);
        // build array of words to use as a path to retrieve completion
        // options from the commands tree
        const words: string[] = allWords
          .filter((e: string, i: number): boolean => {
            if (e.indexOf('-') !== 0) {
              // if the word is not an option check if it's not
              // option's value, eg. --output json, in which case
              // the suggestion should be command options
              return i === 0 || allWords[i - 1].indexOf('-') !== 0;
            }
            else {
              // remove all options but last one
              return i === allWords.length - 1;
            }
          });
        let accessor: Function = new Function('_', "return _['" + (words.join("']['")) + "']");

        replies = accessor(_this.commands);
        // if the last word is an option without autocomplete
        // suggest other options from the same command
        if (words[words.length - 1].indexOf('-') === 0 &&
          !Array.isArray(replies)) {
          accessor = new Function('_', "return _['" + (words.filter(w => w.indexOf('-') !== 0).join("']['")) + "']");
          replies = accessor(_this.commands);

          if (!Array.isArray(replies)) {
            replies = Object.keys(replies);
          }
        }
      }

      if (!Array.isArray(replies)) {
        replies = Object.keys(replies);
      }

      // remove options that already have been used
      replies = (replies as string[]).filter(r => r.indexOf('-') !== 0 || allWords.indexOf(r) === -1);

      this.reply(replies);
    }

    this.omelette = omelette('o365|office365');
    this.omelette.on('complete', handleAutocomplete);
    this.omelette.init();
  }

  public generateShCompletion(vorpal: Vorpal): void {
    const commandsInfo: any = this.getCommandsInfo(vorpal);
    fs.writeFileSync(Autocomplete.autocompleteFilePath, JSON.stringify(commandsInfo));
  }

  public setupShCompletion(): void {
    this.omelette.setupShellInitFile();
  }

  public getClinkCompletion(vorpal: Vorpal): string {
    const cmd: any = this.getCommandsInfo(vorpal);
    const lua: string[] = ['local parser = clink.arg.new_parser'];

    this.buildClinkForBranch(cmd, lua, 'o365');

    lua.push(
      '',
      'clink.arg.register_parser("o365", o365_parser)',
      'clink.arg.register_parser("office365", o365_parser)'
    );

    return lua.join(os.EOL);
  }

  private buildClinkForBranch(branch: any, lua: string[], luaFunctionName: string): void {
    if (!Array.isArray(branch)) {
      const keys: string[] = Object.keys(branch);

      if (keys.length > 0) {
        keys.forEach(k => {
          if (Object.keys(branch[k]).length > 0) {
            this.buildClinkForBranch(branch[k], lua, this.getLuaFunctionName(`${luaFunctionName}_${k}`));
          }
        });
      }
    }

    lua.push(
      '',
      `local ${luaFunctionName}_parser = parser({`
    );

    let printingArgs: boolean = false;

    if (Array.isArray(branch)) {
      if (branch.find(c => c.indexOf('-') === 0)) {
        printingArgs = true;
        lua.push(`},${branch.map(c => `"${c}"`).join(',')}`);
      }
      else {
        branch.sort().forEach((c, i) => {
          const separator = i < branch.length - 1 ? ',' : '';
          lua.push(`  "${c}"${separator}`);
        });
      }
    }
    else {
      const keys = Object.keys(branch);
      if (keys.find(c => c.indexOf('-') === 0)) {
        printingArgs = true;
        const tmp: string[] = [];
        keys.sort().forEach((k, i) => {
          if (Object.keys(branch[k]).length > 0) {
            tmp.push(`"${k}"..${this.getLuaFunctionName(`${luaFunctionName}_${k}_parser`)}`);
          }
          else {
            tmp.push(`"${k}"`);
          }
        });

        lua.push(`},${tmp.join(',')}`);
      }
      else {
        keys.sort().forEach((k, i) => {
          const separator = i < keys.length - 1 ? ',' : '';
          if (Object.keys(branch[k]).length > 0) {
            lua.push(`  "${k}"..${this.getLuaFunctionName(`${luaFunctionName}_${k}_parser`)}${separator}`);
          }
          else {
            lua.push(`  "${k}"${separator}`);
          }
        });
      }
    }

    lua.push(`${printingArgs ? '' : '}'})`);
  }

  private getLuaFunctionName(functionName: string): string {
    return functionName.replace(/-/g, '_');
  }

  private getCommandsInfo(vorpal: Vorpal): any {
    const commandsInfo: any = {};
    const commands: CommandInfo[] = vorpal.commands;
    const visibleCommands: CommandInfo[] = commands.filter(c => !c._hidden);
    visibleCommands.forEach(c => {
      Autocomplete.processCommand(c._name, c, commandsInfo);
      c._aliases.forEach(a => Autocomplete.processCommand(a, c, commandsInfo));
    });

    return commandsInfo;
  }

  private static processCommand(commandName: string, commandInfo: CommandInfo, autocomplete: any) {
    const chunks: string[] = commandName.split(' ');
    let parent: any = autocomplete;
    for (let i: number = 0; i < chunks.length; i++) {
      const current: any = chunks[i];
      if (current === 'exit' || current === 'quit') {
        continue;
      }

      if (!parent[current]) {
        if (i < chunks.length - 1) {
          parent[current] = {};
        }
        else {
          // last chunk, add options
          const optionsArr: string[] = commandInfo.options.map(o => o.short)
            .concat(commandInfo.options.map(o => o.long)).filter(o => o != null);
          optionsArr.push('--help');
          const optionsObj: any = {};
          optionsArr.forEach(o => {
            const option: CommandOption = commandInfo.options.filter(opt => opt.long === o || opt.short === o)[0];
            if (option && option.autocomplete) {
              optionsObj[o] = option.autocomplete;
            }
            else {
              optionsObj[o] = {};
            }
          });
          parent[current] = optionsObj;
        }
      }

      parent = parent[current];
    }
  }
}

export const autocomplete = new Autocomplete();