// ============================================================
// Embedded Linux Analyzer Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { EmbeddedLinuxAnalyzer } from './embedded-linux-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '__fixtures__', 'embedded-linux');

describe('EmbeddedLinuxAnalyzer', () => {
  it('should detect Linux signals', () => {
    const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
    expect(analyzer.hasLinuxSignals()).toBe(true);
  });

  it('should not detect Linux signals on non-Linux temporary directory', () => {
    const tmpDir = path.join(__dirname, '__fixtures__', 'empty-project');
    // Create temp empty dir
    require('fs').mkdirSync(tmpDir, { recursive: true });
    const analyzer = new EmbeddedLinuxAnalyzer(tmpDir);
    expect(analyzer.hasLinuxSignals()).toBe(false);
    require('fs').rmdirSync(tmpDir);
  });

  it('should produce a full analysis result', () => {
    const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
    const result = analyzer.analyze();

    expect(result.profile).toBe('embedded-linux');
    expect(result.summary).toBeTruthy();
    expect(result.summary).toContain('Embedded Linux');
  });

  describe('Kbuild', () => {
    it('should detect obj-y and obj-m targets', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { targets } = result.kbuild;

      expect(targets.length).toBeGreaterThanOrEqual(2);

      // obj-$(CONFIG_FOO_DRIVER) += foo-core.o
      const conditional = targets.find(t => t.config === 'CONFIG_FOO_DRIVER');
      expect(conditional).toBeTruthy();
      expect(conditional!.objects).toContain('foo-core.o');

      // obj-m += bar-module.o
      const moduleTarget = targets.find(t => t.kind === 'module' && t.objects.includes('bar-module.o'));
      expect(moduleTarget).toBeTruthy();
    });

    it('should detect composite targets (foo-core-y)', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const composite = result.kbuild.targets.find(t => t.target === 'foo-core');
      expect(composite).toBeTruthy();
      expect(composite!.objects).toContain('foo-main.o');
      expect(composite!.objects).toContain('foo-utils.o');
    });

    it('should detect ccflags-y', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      expect(result.kbuild.flags.length).toBeGreaterThanOrEqual(1);
      expect(result.kbuild.flags.some(f => f.flag.startsWith('-DDEBUG'))).toBe(true);
    });

    it('should detect subdir-y', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      expect(result.kbuild.targets.some(t => t.kind === 'subdir')).toBe(true);
    });
  });

  describe('Kconfig', () => {
    it('should detect Kconfig options', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { options } = result.kconfig;

      expect(options.length).toBeGreaterThanOrEqual(2);

      const fooDriver = options.find(o => o.name === 'CONFIG_FOO_DRIVER');
      expect(fooDriver).toBeTruthy();
      expect(fooDriver!.type).toBe('tristate');
      expect(fooDriver!.prompt).toContain('Foo driver support');
      expect(fooDriver!.dependsOn).toContain('I2C');
      expect(fooDriver!.selects).toContain('CONFIG_REGMAP_I2C');
      expect(fooDriver!.defaults).toContain('m');

      const fooDebug = options.find(o => o.name === 'CONFIG_FOO_DEBUG');
      expect(fooDebug).toBeTruthy();
      expect(fooDebug!.dependsOn).toContain('FOO_DRIVER');
      expect(fooDebug!.defaults).toContain('n');
    });

    it('should detect enabled state from .config', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      expect(result.kconfig.enabled['CONFIG_FOO_DRIVER']).toBe('m');
      expect(result.kconfig.enabled['CONFIG_FOO_DEBUG']).toBe('y');
      // Unset detection
      expect(result.kconfig.enabled['CONFIG_UNUSED_FEATURE']).toBe('n');
    });

    it('should apply enabled state to options', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const fooDriver = result.kconfig.options.find(o => o.name === 'CONFIG_FOO_DRIVER');
      expect(fooDriver!.enabled).toBe('m');
    });
  });

  describe('Device Tree', () => {
    it('should detect DTS nodes', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { nodes } = result.deviceTree;

      expect(nodes.length).toBeGreaterThanOrEqual(3);

      const uart = nodes.find(n => n.name.startsWith('serial@'));
      expect(uart).toBeTruthy();
      expect(uart!.compatible).toContain('vendor,foo-uart');
      expect(uart!.status).toBe('okay');

      const spi = nodes.find(n => n.name.startsWith('spi@'));
      expect(spi).toBeTruthy();
      expect(spi!.status).toBe('disabled');
    });

    it('should detect compatible strings', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      expect(result.deviceTree.compatibles).toContain('vendor,foo-board');
      expect(result.deviceTree.compatibles).toContain('vendor,foo-uart');
    });
  });

  describe('Kernel Drivers & Modules', () => {
    it('should detect kernel modules with metadata', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const mods = result.kernelModules;

      expect(mods.length).toBeGreaterThanOrEqual(1);
      const fooDriver = mods.find(m => m.name === 'foo_driver');
      expect(fooDriver).toBeTruthy();
      expect(fooDriver!.license).toBe('GPL');
      expect(fooDriver!.author).toContain('Foo Author');
      expect(fooDriver!.description).toContain('Foo Platform Driver');
      expect(fooDriver!.aliases).toContain('platform:foo-driver');
      expect(fooDriver!.params).toContain('debug_mode');
    });

    it('should detect platform drivers', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const drivers = result.drivers;

      const fooDriver = drivers.find(d => d.name === 'foo_driver');
      expect(fooDriver).toBeTruthy();
      expect(fooDriver!.bus).toBe('platform');
      expect(fooDriver!.probe).toBe('foo_probe');
      expect(fooDriver!.remove).toBe('foo_remove');
      expect(fooDriver!.compatibles).toContain('vendor,foo-uart');
      expect(fooDriver!.compatibles).toContain('vendor,foo-i2c');
    });
  });

  describe('Userspace Interfaces', () => {
    it('should detect sysfs attributes', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const sysfs = result.interfaces.filter(i => i.kind === 'sysfs');
      expect(sysfs.length).toBeGreaterThanOrEqual(1);
      expect(sysfs.some(i => i.name === 'foo_value')).toBe(true);
    });

    it('should detect ioctl handlers', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const ioctls = result.interfaces.filter(i => i.kind === 'ioctl');
      expect(ioctls.length).toBeGreaterThanOrEqual(1);
      expect(ioctls.some(i => i.name === 'foo_ioctl' || i.symbol === 'foo_ioctl')).toBe(true);
    });
  });

  describe('Yocto', () => {
    it('should detect Yocto recipes', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { recipes } = result.yocto;

      expect(recipes.length).toBeGreaterThanOrEqual(1);
      const svc = recipes.find(r => r.name === 'foo-service');
      expect(svc).toBeTruthy();
      expect(svc!.summary).toContain('Foo service recipe');
      expect(svc!.license).toContain('GPL-2.0');
      expect(svc!.depends).toContain('libfoo');
      expect(svc!.rdepends).toContain('libfoo-runtime');
      expect(svc!.inherits).toContain('systemd');
      expect(svc!.systemdServices).toContain('foo-service.service');
    });
  });

  describe('Buildroot', () => {
    it('should detect Buildroot packages', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { packages } = result.buildroot;

      expect(packages.length).toBeGreaterThanOrEqual(1);
      const svc = packages.find(p => p.name === 'foo-service');
      expect(svc).toBeTruthy();
      expect(svc!.site).toContain('https://example.com/foo-service');
      expect(svc!.depends).toContain('libfoo');
    });
  });

  describe('Systemd', () => {
    it('should detect systemd services', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const { services } = result;

      expect(services.length).toBeGreaterThanOrEqual(1);
      const svc = services.find(s => s.name === 'foo-service.service');
      expect(svc).toBeTruthy();
      expect(svc!.execStart).toContain('/usr/bin/foo-service');
      expect(svc!.after).toContain('network.target');
      expect(svc!.wantedBy).toContain('multi-user.target');
    });
  });

  describe('Cross-Findings', () => {
    it('should match DTS compatibles to drivers', () => {
      const analyzer = new EmbeddedLinuxAnalyzer(FIXTURES);
      const result = analyzer.analyze();
      const uartNodes = result.deviceTree.nodes.filter(n => n.compatible.includes('vendor,foo-uart'));
      expect(uartNodes.length).toBeGreaterThanOrEqual(1);
      expect(uartNodes[0].matchedDrivers).toContain('foo_driver');
    });
  });
});
