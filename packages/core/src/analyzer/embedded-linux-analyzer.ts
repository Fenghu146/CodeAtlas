// ============================================================
// Embedded Linux Analyzer - Lightweight Linux artifact analysis
// ============================================================
// Detects Kbuild/Kconfig, device tree nodes, kernel drivers/modules,
// userspace interfaces, Yocto/Buildroot metadata, and systemd units.

import fs from 'fs';
import path from 'path';

export interface EmbeddedLinuxFinding {
  severity: 'info' | 'warning' | 'error';
  message: string;
  file?: string;
  line?: number;
}

export interface KbuildTargetInfo {
  target: string;
  kind: 'builtin' | 'module' | 'conditional' | 'subdir';
  objects: string[];
  config?: string;
  file: string;
  line: number;
}

export interface KbuildInfo {
  targets: KbuildTargetInfo[];
  flags: Array<{ flag: string; file: string; line: number }>;
}

export interface KconfigOptionInfo {
  name: string;
  type?: 'bool' | 'tristate' | 'string' | 'int' | 'hex';
  prompt?: string;
  dependsOn: string[];
  selects: string[];
  implies: string[];
  defaults: string[];
  enabled?: 'y' | 'm' | 'n';
  file: string;
  line: number;
}

export interface KconfigInfo {
  options: KconfigOptionInfo[];
  enabled: Record<string, 'y' | 'm' | 'n'>;
}

export interface DeviceTreeNodeInfo {
  name: string;
  label?: string;
  path?: string;
  compatible: string[];
  reg: string[];
  interrupts: string[];
  status?: string;
  phandles: string[];
  file: string;
  line: number;
  matchedDrivers: string[];
}

export interface DeviceTreeInfo {
  nodes: DeviceTreeNodeInfo[];
  compatibles: string[];
  unmatchedCompatibles: string[];
}

export interface KernelModuleInfo {
  name: string;
  file: string;
  line: number;
  init?: string;
  exit?: string;
  license?: string;
  author?: string;
  description?: string;
  aliases: string[];
  params: string[];
}

export type LinuxDriverBus = 'platform' | 'i2c' | 'spi' | 'usb' | 'pci' | 'misc' | 'char' | 'net' | 'unknown';

export interface LinuxDriverInfo {
  name: string;
  bus: LinuxDriverBus;
  file: string;
  line: number;
  probe?: string;
  remove?: string;
  init?: string;
  exit?: string;
  compatibles: string[];
  moduleName?: string;
  matchedDeviceTreeNodes: string[];
}

export interface LinuxUserInterfaceInfo {
  kind: 'sysfs' | 'procfs' | 'debugfs' | 'ioctl' | 'miscdev' | 'chardev' | 'device-node' | 'netlink';
  name: string;
  symbol?: string;
  file: string;
  line: number;
}

export interface YoctoRecipeInfo {
  name: string;
  file: string;
  line: number;
  summary?: string;
  license?: string;
  srcUri: string[];
  depends: string[];
  rdepends: string[];
  inherits: string[];
  systemdServices: string[];
}

export interface YoctoInfo {
  recipes: YoctoRecipeInfo[];
  layers: Array<{ path: string; name?: string }>;
}

export interface BuildrootPackageInfo {
  name: string;
  file: string;
  line: number;
  depends: string[];
  site?: string;
  license?: string;
  config?: string;
}

export interface BuildrootInfo {
  packages: BuildrootPackageInfo[];
}

export interface LinuxServiceInfo {
  name: string;
  file: string;
  line: number;
  execStart?: string;
  requires: string[];
  wants: string[];
  after: string[];
  wantedBy: string[];
}

export interface EmbeddedLinuxAnalysis {
  profile: 'embedded-linux';
  kbuild: KbuildInfo;
  kconfig: KconfigInfo;
  deviceTree: DeviceTreeInfo;
  kernelModules: KernelModuleInfo[];
  drivers: LinuxDriverInfo[];
  interfaces: LinuxUserInterfaceInfo[];
  yocto: YoctoInfo;
  buildroot: BuildrootInfo;
  services: LinuxServiceInfo[];
  findings: EmbeddedLinuxFinding[];
  summary: string;
}

interface SourceFile {
  absolute: string;
  relative: string;
}

const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'out', 'tmp',
  'downloads', 'sstate-cache', '.codeatlas', '.pio', '.venv', 'venv',
]);

/** Lightweight analyzer for embedded Linux projects. */
export class EmbeddedLinuxAnalyzer {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  analyze(): EmbeddedLinuxAnalysis {
    const files = this.collectFiles(this.projectPath);
    const findings: EmbeddedLinuxFinding[] = [];

    const kbuild = this.parseKbuild(files);
    const kconfig = this.parseKconfig(files);
    const modulesAndDrivers = this.parseKernelSources(files);
    const deviceTree = this.parseDeviceTree(files, modulesAndDrivers.drivers);
    const yocto = this.parseYocto(files);
    const buildroot = this.parseBuildroot(files);
    const services = this.parseSystemd(files);

    this.addCrossFindings(deviceTree, modulesAndDrivers.drivers, kconfig, findings);

    const result: EmbeddedLinuxAnalysis = {
      profile: 'embedded-linux',
      kbuild,
      kconfig,
      deviceTree,
      kernelModules: modulesAndDrivers.modules,
      drivers: modulesAndDrivers.drivers,
      interfaces: modulesAndDrivers.interfaces,
      yocto,
      buildroot,
      services,
      findings,
      summary: '',
    };
    result.summary = this.buildSummary(result);
    return result;
  }

  hasLinuxSignals(): boolean {
    const files = this.collectFiles(this.projectPath, 200);
    return files.some(f => {
      const base = path.basename(f.relative);
      const ext = path.extname(f.relative).toLowerCase();
      if (base === 'Kconfig' || base === 'Kbuild' || base === '.config' || base.endsWith('defconfig')) return true;
      if (['.dts', '.dtsi', '.dtso', '.bb', '.bbappend', '.bbclass', '.service'].includes(ext)) return true;
      if (base === 'Makefile') {
        const content = this.safeRead(f.absolute, 32 * 1024);
        return /\bobj-[ym]\b|obj-\$\(CONFIG_|ccflags-y/.test(content);
      }
      return false;
    });
  }

  private collectFiles(root: string, maxFiles = 5000): SourceFile[] {
    const files: SourceFile[] = [];
    const visit = (dir: string) => {
      if (files.length >= maxFiles) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        const absolute = path.join(dir, entry.name);
        const relative = path.relative(root, absolute).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) visit(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        if (this.isInterestingFile(relative)) files.push({ absolute, relative });
      }
    };
    visit(root);
    return files;
  }

  private isInterestingFile(file: string): boolean {
    const base = path.basename(file);
    const ext = path.extname(file).toLowerCase();
    return base === 'Makefile' || base === 'Kbuild' || base === 'Kconfig' || base === '.config' ||
      base.endsWith('defconfig') || base === 'Config.in' ||
      ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx', '.dts', '.dtsi', '.dtso', '.bb', '.bbappend', '.bbclass', '.conf', '.mk', '.service', '.sh'].includes(ext) ||
      file.includes('/init.d/');
  }

  private safeRead(file: string, maxBytes = 512 * 1024): string {
    try {
      const stat = fs.statSync(file);
      if (stat.size > maxBytes) return fs.readFileSync(file, 'utf-8').slice(0, maxBytes);
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return '';
    }
  }

  private parseKbuild(files: SourceFile[]): KbuildInfo {
    const targets: KbuildTargetInfo[] = [];
    const flags: Array<{ flag: string; file: string; line: number }> = [];

    for (const file of files) {
      const base = path.basename(file.relative);
      if (base !== 'Makefile' && base !== 'Kbuild') continue;
      const lines = this.safeRead(file.absolute).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/#.*/, '').trim();
        if (!line) continue;

        const flagMatch = line.match(/^ccflags-y\s*(?:\+?=|:=)\s*(.+)$/);
        if (flagMatch) {
          for (const flag of flagMatch[1].split(/\s+/).filter(Boolean)) {
            flags.push({ flag, file: file.relative, line: i + 1 });
          }
          continue;
        }

        const subdirMatch = line.match(/^subdir-y\s*(?:\+?=|:=)\s*(.+)$/);
        if (subdirMatch) {
          targets.push({ target: 'subdir-y', kind: 'subdir', objects: this.splitMakeWords(subdirMatch[1]), file: file.relative, line: i + 1 });
          continue;
        }

        const objMatch = line.match(/^obj-(y|m|\$\(CONFIG_([A-Za-z0-9_]+)\))\s*(?:\+?=|:=)\s*(.+)$/);
        if (objMatch) {
          const selector = objMatch[1];
          const config = objMatch[2] ? `CONFIG_${objMatch[2]}` : undefined;
          const objects = this.splitMakeWords(objMatch[3]);
          const kind: KbuildTargetInfo['kind'] = selector === 'y' ? 'builtin' : selector === 'm' ? 'module' : 'conditional';
          targets.push({ target: selector, kind, objects, config, file: file.relative, line: i + 1 });
          continue;
        }

        const compositeMatch = line.match(/^([A-Za-z0-9_.-]+)-(y|m)\s*(?:\+?=|:=)\s*(.+)$/);
        if (compositeMatch) {
          targets.push({ target: compositeMatch[1], kind: compositeMatch[2] === 'm' ? 'module' : 'builtin', objects: this.splitMakeWords(compositeMatch[3]), file: file.relative, line: i + 1 });
        }
      }
    }

    return { targets, flags };
  }

  private splitMakeWords(value: string): string[] {
    return value.replace(/\\\s*$/, '').split(/\s+/).map(s => s.trim()).filter(Boolean);
  }

  private parseKconfig(files: SourceFile[]): KconfigInfo {
    const options: KconfigOptionInfo[] = [];
    const enabled: Record<string, 'y' | 'm' | 'n'> = {};

    for (const file of files) {
      const base = path.basename(file.relative);
      if (base === '.config' || base.endsWith('defconfig')) {
        const lines = this.safeRead(file.absolute).split(/\r?\n/);
        for (const line of lines) {
          const setMatch = line.match(/^CONFIG_([A-Za-z0-9_]+)=(y|m|n|.+)$/);
          if (setMatch) enabled[`CONFIG_${setMatch[1]}`] = ['y', 'm', 'n'].includes(setMatch[2]) ? setMatch[2] as 'y' | 'm' | 'n' : 'y';
          const unsetMatch = line.match(/^#\s*CONFIG_([A-Za-z0-9_]+)\s+is\s+not\s+set/);
          if (unsetMatch) enabled[`CONFIG_${unsetMatch[1]}`] = 'n';
        }
      }

      if (base !== 'Kconfig' && base !== 'Config.in') continue;
      const lines = this.safeRead(file.absolute).split(/\r?\n/);
      let current: KconfigOptionInfo | null = null;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const configMatch = trimmed.match(/^(?:menuconfig|config)\s+([A-Za-z0-9_]+)/);
        if (configMatch) {
          current = {
            name: `CONFIG_${configMatch[1]}`,
            dependsOn: [],
            selects: [],
            implies: [],
            defaults: [],
            file: file.relative,
            line: i + 1,
          };
          options.push(current);
          continue;
        }
        if (!current) continue;
        const typeMatch = trimmed.match(/^(bool|tristate|string|int|hex)(?:\s+"([^"]+)")?/);
        if (typeMatch) {
          current.type = typeMatch[1] as KconfigOptionInfo['type'];
          if (typeMatch[2]) current.prompt = typeMatch[2];
        }
        const dependsMatch = trimmed.match(/^depends\s+on\s+(.+)$/);
        if (dependsMatch) current.dependsOn.push(dependsMatch[1]);
        const selectMatch = trimmed.match(/^select\s+([A-Za-z0-9_]+)/);
        if (selectMatch) current.selects.push(`CONFIG_${selectMatch[1]}`);
        const implyMatch = trimmed.match(/^imply\s+([A-Za-z0-9_]+)/);
        if (implyMatch) current.implies.push(`CONFIG_${implyMatch[1]}`);
        const defaultMatch = trimmed.match(/^default\s+(.+)$/);
        if (defaultMatch) current.defaults.push(defaultMatch[1]);
      }
    }

    for (const option of options) {
      if (enabled[option.name]) option.enabled = enabled[option.name];
    }

    return { options, enabled };
  }

  private parseDeviceTree(files: SourceFile[], drivers: LinuxDriverInfo[]): DeviceTreeInfo {
    const nodes: DeviceTreeNodeInfo[] = [];
    const compatibleSet = new Set<string>();
    const driverCompatibles = new Map<string, string[]>();
    for (const driver of drivers) {
      for (const compatible of driver.compatibles) {
        if (!driverCompatibles.has(compatible)) driverCompatibles.set(compatible, []);
        driverCompatibles.get(compatible)!.push(driver.name);
      }
    }

    for (const file of files) {
      const ext = path.extname(file.relative).toLowerCase();
      if (!['.dts', '.dtsi', '.dtso'].includes(ext)) continue;
      const lines = this.safeRead(file.absolute).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('compatible')) continue;
        const compatible = this.extractQuotedValues(lines[i]);
        if (compatible.length === 0) continue;
        compatible.forEach(c => compatibleSet.add(c));

        const header = this.findDeviceTreeNodeHeader(lines, i);
        const block = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
        const reg = this.extractPropertyValues(block, 'reg');
        const interrupts = this.extractPropertyValues(block, 'interrupts');
        const status = this.extractQuotedProperty(block, 'status');
        const phandles = Array.from(block.matchAll(/&([A-Za-z0-9_]+)/g)).map(m => m[1]);
        const matchedDrivers = compatible.flatMap(c => driverCompatibles.get(c) ?? []);

        nodes.push({
          name: header.name,
          label: header.label,
          compatible,
          reg,
          interrupts,
          status,
          phandles,
          file: file.relative,
          line: i + 1,
          matchedDrivers: Array.from(new Set(matchedDrivers)),
        });
      }
    }

    const unmatchedCompatibles = Array.from(compatibleSet).filter(c => !driverCompatibles.has(c));
    return { nodes, compatibles: Array.from(compatibleSet).sort(), unmatchedCompatibles };
  }

  private findDeviceTreeNodeHeader(lines: string[], index: number): { name: string; label?: string } {
    for (let i = index; i >= Math.max(0, index - 20); i--) {
      const match = lines[i].match(/(?:([A-Za-z0-9_]+)\s*:\s*)?([A-Za-z0-9,_-]+@[A-Fa-f0-9x]+|[A-Za-z0-9,_-]+)\s*\{/);
      if (match) return { label: match[1], name: match[2] };
    }
    return { name: 'node' };
  }

  private extractQuotedValues(text: string): string[] {
    return Array.from(text.matchAll(/"([^"]+)"/g)).map(m => m[1]);
  }

  private extractPropertyValues(block: string, property: string): string[] {
    const match = block.match(new RegExp(`${property}\\s*=\\s*([^;]+);`));
    if (!match) return [];
    return [match[1].trim()];
  }

  private extractQuotedProperty(block: string, property: string): string | undefined {
    const match = block.match(new RegExp(`${property}\\s*=\\s*"([^"]+)"`));
    return match?.[1];
  }

  private parseKernelSources(files: SourceFile[]): { modules: KernelModuleInfo[]; drivers: LinuxDriverInfo[]; interfaces: LinuxUserInterfaceInfo[] } {
    const modules: KernelModuleInfo[] = [];
    const drivers: LinuxDriverInfo[] = [];
    const interfaces: LinuxUserInterfaceInfo[] = [];

    for (const file of files) {
      const ext = path.extname(file.relative).toLowerCase();
      if (!['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx'].includes(ext)) continue;
      const content = this.safeRead(file.absolute);
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      const compatibles = Array.from(content.matchAll(/\.compatible\s*=\s*"([^"]+)"/g)).map(m => m[1]);
      const init = content.match(/module_init\s*\(\s*(\w+)\s*\)/)?.[1];
      const exit = content.match(/module_exit\s*\(\s*(\w+)\s*\)/)?.[1];
      const license = content.match(/MODULE_LICENSE\s*\(\s*"([^"]+)"\s*\)/)?.[1];
      const author = content.match(/MODULE_AUTHOR\s*\(\s*"([^"]+)"\s*\)/)?.[1];
      const description = content.match(/MODULE_DESCRIPTION\s*\(\s*"([^"]+)"\s*\)/)?.[1];
      const aliases = Array.from(content.matchAll(/MODULE_ALIAS\s*\(\s*"([^"]+)"\s*\)/g)).map(m => m[1]);
      const params = Array.from(content.matchAll(/module_param\s*\(\s*(\w+)/g)).map(m => m[1]);

      if (init || exit || license || description || aliases.length > 0) {
        modules.push({
          name: path.basename(file.relative, ext),
          file: file.relative,
          line: this.findLine(lines, /module_init|MODULE_LICENSE|MODULE_DESCRIPTION/),
          init,
          exit,
          license,
          author,
          description,
          aliases,
          params,
        });
      }

      const driverRegex = /struct\s+(platform|i2c|spi|usb|pci|misc|net)_driver\s+(\w+)/g;
      let driverMatch: RegExpExecArray | null;
      while ((driverMatch = driverRegex.exec(content)) !== null) {
        const bus = driverMatch[1] as LinuxDriverBus;
        const name = driverMatch[2];
        const startLine = this.offsetToLine(content, driverMatch.index);
        const block = lines.slice(startLine - 1, startLine + 80).join('\n');
        drivers.push({
          name,
          bus,
          file: file.relative,
          line: startLine,
          probe: block.match(/\.probe\s*=\s*(\w+)/)?.[1],
          remove: block.match(/\.remove(?:_new)?\s*=\s*(\w+)/)?.[1],
          init,
          exit,
          compatibles,
          moduleName: path.basename(file.relative, ext),
          matchedDeviceTreeNodes: [],
        });
      }

      if (/register_chrdev|alloc_chrdev_region|cdev_init/.test(content)) {
        interfaces.push({ kind: 'chardev', name: path.basename(file.relative, ext), file: file.relative, line: this.findLine(lines, /register_chrdev|alloc_chrdev_region|cdev_init/) });
      }
      if (/misc_register/.test(content)) {
        interfaces.push({ kind: 'miscdev', name: content.match(/\.name\s*=\s*"([^"]+)"/)?.[1] ?? path.basename(file.relative, ext), file: file.relative, line: this.findLine(lines, /misc_register/) });
      }
      for (const match of content.matchAll(/DEVICE_ATTR(?:_[A-Z]+)?\s*\(\s*(\w+)/g)) {
        interfaces.push({ kind: 'sysfs', name: match[1], file: file.relative, line: this.offsetToLine(content, match.index ?? 0) });
      }
      for (const match of content.matchAll(/proc_create\s*\(\s*"([^"]+)"/g)) {
        interfaces.push({ kind: 'procfs', name: match[1], file: file.relative, line: this.offsetToLine(content, match.index ?? 0) });
      }
      for (const match of content.matchAll(/debugfs_create_(?:file|dir)\s*\(\s*"([^"]+)"/g)) {
        interfaces.push({ kind: 'debugfs', name: match[1], file: file.relative, line: this.offsetToLine(content, match.index ?? 0) });
      }
      const ioctl = content.match(/\.unlocked_ioctl\s*=\s*(\w+)|\.compat_ioctl\s*=\s*(\w+)/);
      if (ioctl) {
        interfaces.push({ kind: 'ioctl', name: ioctl[1] ?? ioctl[2], symbol: ioctl[1] ?? ioctl[2], file: file.relative, line: this.findLine(lines, /\.unlocked_ioctl|\.compat_ioctl/) });
      }
      if (/device_create\s*\(/.test(content)) {
        interfaces.push({ kind: 'device-node', name: path.basename(file.relative, ext), file: file.relative, line: this.findLine(lines, /device_create\s*\(/) });
      }
      if (/netlink_kernel_create/.test(content)) {
        interfaces.push({ kind: 'netlink', name: path.basename(file.relative, ext), file: file.relative, line: this.findLine(lines, /netlink_kernel_create/) });
      }
    }

    return { modules, drivers, interfaces };
  }

  private parseYocto(files: SourceFile[]): YoctoInfo {
    const recipes: YoctoRecipeInfo[] = [];
    const layers: Array<{ path: string; name?: string }> = [];

    for (const file of files) {
      const base = path.basename(file.relative);
      const ext = path.extname(file.relative).toLowerCase();
      const content = this.safeRead(file.absolute);
      if (file.relative.endsWith('conf/layer.conf')) {
        layers.push({ path: file.relative, name: content.match(/BBFILE_COLLECTIONS\s*[+?:]?=\s*"?([^"\n]+)"?/)?.[1]?.trim() });
      }
      if (!['.bb', '.bbappend', '.bbclass'].includes(ext)) continue;
      recipes.push({
        name: base.replace(/\.(bbappend|bbclass|bb)$/, ''),
        file: file.relative,
        line: 1,
        summary: this.extractAssignment(content, 'SUMMARY'),
        license: this.extractAssignment(content, 'LICENSE'),
        srcUri: this.splitVar(this.extractAssignment(content, 'SRC_URI')),
        depends: this.splitVar(this.extractAssignment(content, 'DEPENDS')),
        rdepends: this.splitVar(this.extractAssignment(content, 'RDEPENDS') ?? this.extractAssignment(content, 'RDEPENDS_${PN}')),
        inherits: this.splitVar(content.match(/^inherit\s+(.+)$/m)?.[1]),
        systemdServices: this.splitVar(this.extractAssignment(content, 'SYSTEMD_SERVICE') ?? this.extractAssignment(content, 'SYSTEMD_SERVICE_${PN}')),
      });
    }

    return { recipes, layers };
  }

  private parseBuildroot(files: SourceFile[]): BuildrootInfo {
    const packages: BuildrootPackageInfo[] = [];
    const configToFile = new Map<string, { file: string; line: number }>();

    for (const file of files) {
      const base = path.basename(file.relative);
      const content = this.safeRead(file.absolute);
      if (base === 'Config.in') {
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].trim().match(/^config\s+(BR2_PACKAGE_[A-Za-z0-9_]+)/);
          if (match) configToFile.set(match[1], { file: file.relative, line: i + 1 });
        }
      }
    }

    for (const file of files) {
      if (path.extname(file.relative).toLowerCase() !== '.mk') continue;
      const content = this.safeRead(file.absolute);
      const nameMatch = content.match(/^([A-Z0-9_]+)_VERSION\s*[+?:]?=/m) ?? content.match(/^([A-Z0-9_]+)_SITE\s*[+?:]?=/m);
      if (!nameMatch) continue;
      const prefix = nameMatch[1];
      const config = `BR2_PACKAGE_${prefix}`;
      const configLoc = configToFile.get(config);
      packages.push({
        name: prefix.toLowerCase().replace(/_/g, '-'),
        file: file.relative,
        line: 1,
        depends: this.splitVar(this.extractAssignment(content, `${prefix}_DEPENDENCIES`)),
        site: this.extractAssignment(content, `${prefix}_SITE`),
        license: this.extractAssignment(content, `${prefix}_LICENSE`),
        config: configLoc ? config : undefined,
      });
    }

    return { packages };
  }

  private parseSystemd(files: SourceFile[]): LinuxServiceInfo[] {
    const services: LinuxServiceInfo[] = [];
    for (const file of files) {
      if (path.extname(file.relative).toLowerCase() !== '.service') continue;
      const content = this.safeRead(file.absolute);
      services.push({
        name: path.basename(file.relative),
        file: file.relative,
        line: 1,
        execStart: content.match(/^ExecStart=(.+)$/m)?.[1]?.trim(),
        requires: this.splitListDirective(content, 'Requires'),
        wants: this.splitListDirective(content, 'Wants'),
        after: this.splitListDirective(content, 'After'),
        wantedBy: this.splitListDirective(content, 'WantedBy'),
      });
    }
    return services;
  }

  private addCrossFindings(deviceTree: DeviceTreeInfo, drivers: LinuxDriverInfo[], kconfig: KconfigInfo, findings: EmbeddedLinuxFinding[]): void {
    const compatibleToNodes = new Map<string, DeviceTreeNodeInfo[]>();
    for (const node of deviceTree.nodes) {
      for (const compatible of node.compatible) {
        if (!compatibleToNodes.has(compatible)) compatibleToNodes.set(compatible, []);
        compatibleToNodes.get(compatible)!.push(node);
      }
    }

    for (const driver of drivers) {
      const matchedNodes = driver.compatibles.flatMap(c => compatibleToNodes.get(c) ?? []);
      driver.matchedDeviceTreeNodes = matchedNodes.map(n => n.label ?? n.name);
      if (driver.compatibles.length > 0 && matchedNodes.length === 0) {
        findings.push({ severity: 'warning', message: `Driver ${driver.name} has compatible strings but no matching device-tree node was found.`, file: driver.file, line: driver.line });
      }
      if (!driver.probe && ['platform', 'i2c', 'spi', 'usb', 'pci'].includes(driver.bus)) {
        findings.push({ severity: 'info', message: `Driver ${driver.name} has no probe callback detected.`, file: driver.file, line: driver.line });
      }
    }

    for (const compatible of deviceTree.unmatchedCompatibles.slice(0, 20)) {
      findings.push({ severity: 'info', message: `Device-tree compatible "${compatible}" has no matching driver compatible in scanned sources.` });
    }

    const usedConfigs = new Set<string>();
    for (const option of kconfig.options) usedConfigs.add(option.name);
    for (const option of kconfig.options) {
      for (const dep of option.selects) {
        if (!usedConfigs.has(dep)) findings.push({ severity: 'info', message: `${option.name} selects ${dep}, but ${dep} is not defined in scanned Kconfig files.`, file: option.file, line: option.line });
      }
    }
  }

  private extractAssignment(content: string, variable: string): string | undefined {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match Yocto-style assignments: VARIABLE = "value", VARIABLE:override = "value", VARIABLE_${VAR} = "value"
    const match = content.match(new RegExp(`^${escaped}(?:[:][^=]*)?\\s*(?:[:+?]?=)\\s*"?([^"\\n]+)"?`, 'm'));
    return match?.[1]?.trim();
  }

  private splitVar(value?: string): string[] {
    if (!value) return [];
    return value.replace(/\\\s*\n/g, ' ').split(/\s+/).map(s => s.replace(/["']/g, '').trim()).filter(Boolean);
  }

  private splitListDirective(content: string, directive: string): string[] {
    const match = content.match(new RegExp(`^${directive}=(.+)$`, 'm'));
    return this.splitVar(match?.[1]);
  }

  private findLine(lines: string[], regex: RegExp): number {
    const index = lines.findIndex(line => regex.test(line));
    return index >= 0 ? index + 1 : 1;
  }

  private offsetToLine(content: string, offset: number): number {
    return content.slice(0, offset).split(/\r?\n/).length;
  }

  private buildSummary(result: EmbeddedLinuxAnalysis): string {
    const parts: string[] = [];
    parts.push('🐧 Embedded Linux Analysis');
    parts.push('═'.repeat(40));
    parts.push(`Kbuild targets: ${result.kbuild.targets.length}`);
    parts.push(`Kconfig options: ${result.kconfig.options.length}`);
    parts.push(`Device-tree nodes: ${result.deviceTree.nodes.length} (${result.deviceTree.compatibles.length} compatible strings)`);
    parts.push(`Kernel modules: ${result.kernelModules.length}`);
    parts.push(`Drivers: ${result.drivers.length}`);
    parts.push(`Userspace interfaces: ${result.interfaces.length}`);
    parts.push(`Yocto recipes: ${result.yocto.recipes.length}`);
    parts.push(`Buildroot packages: ${result.buildroot.packages.length}`);
    parts.push(`Systemd services: ${result.services.length}`);

    if (result.drivers.length > 0) {
      const byBus = new Map<string, number>();
      for (const driver of result.drivers) byBus.set(driver.bus, (byBus.get(driver.bus) ?? 0) + 1);
      parts.push(`\nDrivers by bus: ${Array.from(byBus.entries()).map(([bus, count]) => `${bus}=${count}`).join(', ')}`);
      for (const driver of result.drivers.slice(0, 8)) {
        const compat = driver.compatibles.length ? ` compatible=${driver.compatibles.join(',')}` : '';
        parts.push(`  - ${driver.name} [${driver.bus}] @ ${driver.file}:${driver.line}${compat}`);
      }
    }

    if (result.findings.length > 0) {
      parts.push(`\nFindings (${result.findings.length}):`);
      for (const finding of result.findings.slice(0, 8)) {
        const loc = finding.file ? ` @ ${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
        parts.push(`  - [${finding.severity}] ${finding.message}${loc}`);
      }
    }

    return parts.join('\n');
  }
}
