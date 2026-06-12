// ============================================================
// Embedded Analyzer - Analyzes embedded systems code
// ============================================================
// Detects: RTOS tasks, interrupt handlers, hardware access,
// memory patterns, and build configuration.

import fs from 'fs';
import path from 'path';
import { SQLiteStore } from '../store/sqlite-store.js';
import { BuildAnalyzer, type BuildConfig } from './build-analyzer.js';
import type { Symbol } from '../graph/types.js';

export interface RTOSTask {
  /** Task name */
  name: string;
  /** Task function */
  function: string;
  /** Stack size */
  stackSize?: number;
  /** Priority */
  priority?: number;
  /** File location */
  file: string;
  /** Line number */
  line: number;
}

export interface InterruptHandler {
  /** Handler name */
  name: string;
  /** IRQ number (if known) */
  irqNumber?: string;
  /** Interrupt source */
  source?: string;
  /** File location */
  file: string;
  /** Line number */
  line: number;
}

export interface HardwareAccess {
  /** Register or peripheral name */
  peripheral: string;
  /** Access type (read/write) */
  accessType: 'read' | 'write' | 'both';
  /** File location */
  file: string;
  /** Line number */
  line: number;
}

export interface MemoryLayout {
  /** SRAM usage estimate */
  sramUsage?: number;
  /** Flash usage estimate */
  flashUsage?: number;
  /** Stack size */
  stackSize?: number;
  /** Heap size */
  heapSize?: number;
}

export interface EmbeddedAnalysisResult {
  /** RTOS tasks detected */
  tasks: RTOSTask[];
  /** Interrupt handlers */
  interrupts: InterruptHandler[];
  /** Hardware access patterns */
  hardwareAccess: HardwareAccess[];
  /** Build configuration */
  buildConfig: BuildConfig;
  /** Memory layout (if detectable) */
  memoryLayout?: MemoryLayout;
  /** Summary */
  summary: string;
}

/**
 * Analyzes embedded systems code for RTOS, interrupts, hardware access.
 */
export class EmbeddedAnalyzer {
  private store: SQLiteStore;
  private projectPath: string;

  constructor(store: SQLiteStore, projectPath: string) {
    this.store = store;
    this.projectPath = projectPath;
  }

  /**
   * Run full embedded analysis.
   */
  analyze(): EmbeddedAnalysisResult {
    // For build analysis, try to find project root by looking for platformio.ini/CMakeLists.txt
    const projectRoot = this.findProjectRoot();
    const buildAnalyzer = new BuildAnalyzer(projectRoot);
    const buildConfig = buildAnalyzer.analyze();

    const tasks = this.detectRTOS();
    const interrupts = this.detectInterrupts();
    const hardwareAccess = this.detectHardwareAccess();
    const memoryLayout = this.detectMemoryLayout();

    const summary = this.buildSummary(tasks, interrupts, hardwareAccess, buildConfig);

    return {
      tasks,
      interrupts,
      hardwareAccess,
      buildConfig,
      memoryLayout,
      summary,
    };
  }

  /**
   * Detect RTOS tasks (FreeRTOS, Zephyr, etc.).
   */
  private detectRTOS(): RTOSTask[] {
    const tasks: RTOSTask[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    // FreeRTOS task creation patterns
    const freertosPatterns = [
      { regex: /xTaskCreate\s*\(\s*(\w+)\s*,\s*["']([^"']+)["']/, nameGroup: 2, funcGroup: 1 },
      { regex: /xTaskCreateStatic\s*\(\s*(\w+)\s*,\s*["']([^"']+)["']/, nameGroup: 2, funcGroup: 1 },
      { regex: /xTaskCreatePinnedToCore\s*\(\s*(\w+)\s*,\s*["']([^"']+)["']/, nameGroup: 2, funcGroup: 1 },
      { regex: /xTaskCreateRestricted\s*\(\s*[^,]+,\s*["']([^"']+)["']/, nameGroup: 1, funcGroup: 0 },
    ];

    // Zephyr patterns
    const zephyrPatterns = [
      { regex: /K_THREAD_DEFINE\s*\(\s*(\w+)/, nameGroup: 1, funcGroup: 1 },
      { regex: /k_thread_create\s*\(\s*&(\w+)/, nameGroup: 1, funcGroup: 1 },
    ];

    for (const symbol of allSymbols) {
      if (!symbol.sourceCode) continue;

      // Check for FreeRTOS task creation
      for (const { regex, nameGroup, funcGroup } of freertosPatterns) {
        const match = symbol.sourceCode.match(regex);
        if (match) {
          tasks.push({
            name: match[nameGroup] || match[1],
            function: funcGroup > 0 ? match[funcGroup] : match[1],
            file: symbol.filePath,
            line: symbol.startLine,
          });
          break; // Only match one pattern per symbol
        }
      }

      // Check for Zephyr threads
      for (const { regex, nameGroup, funcGroup } of zephyrPatterns) {
        const match = symbol.sourceCode.match(regex);
        if (match) {
          tasks.push({
            name: match[nameGroup],
            function: funcGroup > 0 ? match[funcGroup] : match[1],
            file: symbol.filePath,
            line: symbol.startLine,
          });
          break;
        }
      }
    }

    return tasks;
  }

  /**
   * Detect interrupt handlers.
   */
  private detectInterrupts(): InterruptHandler[] {
    const handlers: InterruptHandler[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    // Common ISR patterns
    const isrPatterns = [
      { pattern: /void\s+(\w+_IRQHandler)\s*\(/, source: 'STM32' },
      { pattern: /void\s+IRAM_ATTR\s+(\w+)\s*\(/, source: 'ESP32' },
      { pattern: /IRAM_ATTR\s+void\s+(\w+)\s*\(/, source: 'ESP32' },
      { pattern: /ISR\s*\(\s*(\w+)\s*\)/, source: 'Arduino' },
      { pattern: /__interrupt\s+void\s+(\w+)/, source: 'MSP430' },
      { pattern: /#pragma\s+vector\s*=\s*(\w+)\s*/, source: 'MSP430' },
      { pattern: /void\s+handleISR\s*\(/, source: 'ESP32' },
      { pattern: /static\s+void\s+IRAM_ATTR\s+(\w+)\s*\(/, source: 'ESP32' },
    ];

    for (const symbol of allSymbols) {
      if (!symbol.sourceCode) continue;

      for (const { pattern, source } of isrPatterns) {
        const match = symbol.sourceCode.match(pattern);
        if (match) {
          handlers.push({
            name: match[1],
            source,
            file: symbol.filePath,
            line: symbol.startLine,
          });
        }
      }

      // Also check function names for common ISR suffixes
      if (symbol.name.endsWith('_IRQHandler') ||
          symbol.name.endsWith('_Handler') ||
          symbol.name.startsWith('ISR_') ||
          symbol.name.endsWith('ISR')) {
        handlers.push({
          name: symbol.name,
          file: symbol.filePath,
          line: symbol.startLine,
        });
      }
    }

    return handlers;
  }

  /**
   * Detect hardware access patterns.
   */
  private detectHardwareAccess(): HardwareAccess[] {
    const access: HardwareAccess[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    // Comprehensive peripheral patterns for embedded systems
    const peripheralPatterns = [
      // STM32 HAL
      'GPIO', 'UART', 'SPI', 'I2C', 'ADC', 'DAC', 'PWM',
      'TIM', 'TIM1', 'TIM2', 'TIM3', 'TIM4',
      'USART', 'USART1', 'USART2',
      'SPI1', 'SPI2', 'I2C1', 'I2C2',
      'DMA', 'DMA1', 'DMA2',
      'NVIC', 'SCB', 'SysTick',
      'RCC', 'PWR', 'FLASH',
      'RTC', 'WDG', 'IWDG', 'WWDG',
      // ESP-IDF / Arduino
      'gpio', 'uart', 'spi', 'i2c', 'adc', 'dac', 'ledc',
      'timer', 'pcnt', 'mcpwm',
      // Common APIs
      'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite',
      'pinMode', 'delay', 'millis', 'micros',
      // Communication
      'Wire', 'SPI', 'Serial', 'BLEDevice', 'WiFi',
      // Storage
      'Preferences', 'SPIFFS', 'LittleFS', 'EEPROM',
      // Audio
      'i2s', 'I2S', 'audio', 'Audio',
      // Display
      'TFT', 'tft', 'display', 'Display', 'lcd', 'LCD',
      // Sensors
      'sensor', 'Sensor', 'imu', 'IMU', 'accel', 'gyro',
    ];

    for (const symbol of allSymbols) {
      if (!symbol.sourceCode) continue;

      for (const peripheral of peripheralPatterns) {
        // Check for register access patterns
        if (symbol.sourceCode.includes(`${peripheral}->`) ||
            symbol.sourceCode.includes(`${peripheral}_`) ||
            symbol.sourceCode.includes(`HAL_${peripheral}_`) ||
            symbol.sourceCode.includes(`${peripheral}.`) ||
            symbol.sourceCode.includes(`${peripheral}::`)) {
          access.push({
            peripheral,
            accessType: symbol.sourceCode.includes(`${peripheral}->CR`) ||
                        symbol.sourceCode.includes(`${peripheral}->DR`) ||
                        symbol.sourceCode.includes(`${peripheral}.write`) ||
                        symbol.sourceCode.includes(`${peripheral}.begin`) ?
                        'write' : 'read',
            file: symbol.filePath,
            line: symbol.startLine,
          });
        }
      }
    }

    return access;
  }

  /**
   * Detect memory layout from linker scripts or build config.
   */
  private detectMemoryLayout(): MemoryLayout | undefined {
    // Try to find linker script
    const linkerPatterns = [
      '*.ld', '*.lds', '*.ld.S',
      '*.scatter', '*.icf',
    ];

    // Try to find memory configuration in source
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      if (!symbol.sourceCode) continue;

      // Check for stack/heap configuration
      const stackMatch = symbol.sourceCode.match(/(?:STACK_SIZE|HEAP_SIZE)\s*=\s*(\d+)/);
      if (stackMatch) {
        return {
          stackSize: parseInt(stackMatch[1]),
        };
      }
    }

    return undefined;
  }

  /**
   * Find project root by looking for build config files.
   * Searches up to 5 parent directories.
   */
  private findProjectRoot(): string {
    const buildFiles = [
      'platformio.ini', 'CMakeLists.txt', 'Makefile', 'Cargo.toml',
      'package.json', 'go.mod', 'requirements.txt',
      '.codeatlas', '.codeatlas.yaml', '.codeatlas.json',  // Also look for CodeAtlas config
    ];

    let searchPath = this.projectPath;
    for (let i = 0; i < 6; i++) {
      for (const file of buildFiles) {
        const fullPath = path.join(searchPath, file);
        if (fs.existsSync(fullPath)) {
          return searchPath;
        }
      }
      const parent = path.dirname(searchPath);
      if (parent === searchPath) break;
      searchPath = parent;
    }

    return this.projectPath;
  }

  /**
   * Build summary text.
   */
  private buildSummary(
    tasks: RTOSTask[],
    interrupts: InterruptHandler[],
    hardwareAccess: HardwareAccess[],
    buildConfig: BuildConfig,
  ): string {
    const parts: string[] = [];

    parts.push('🔧 Embedded Systems Analysis');
    parts.push('═'.repeat(40));

    // Build system
    parts.push(`\n📦 Build System: ${buildConfig.type}`);
    if (buildConfig.platform) parts.push(`   Platform: ${buildConfig.platform}`);
    if (buildConfig.board) parts.push(`   Board: ${buildConfig.board}`);
    if (buildConfig.framework) parts.push(`   Framework: ${buildConfig.framework}`);

    // RTOS tasks
    if (tasks.length > 0) {
      parts.push(`\n🔄 RTOS Tasks (${tasks.length}):`);
      for (const task of tasks) {
        parts.push(`   - ${task.name} → ${task.function} @ ${task.file}:${task.line}`);
      }
    }

    // Interrupt handlers
    if (interrupts.length > 0) {
      parts.push(`\n⚡ Interrupt Handlers (${interrupts.length}):`);
      for (const h of interrupts.slice(0, 10)) {
        const source = h.source ? ` (${h.source})` : '';
        parts.push(`   - ${h.name}${source} @ ${h.file}:${h.line}`);
      }
      if (interrupts.length > 10) parts.push(`   ... and ${interrupts.length - 10} more`);
    }

    // Hardware access (with deduplication)
    if (hardwareAccess.length > 0) {
      const uniquePeripherals = this.deduplicatePeripherals(hardwareAccess);
      parts.push(`\n🔌 Hardware Peripherals (${uniquePeripherals.length}):`);
      parts.push(`   ${uniquePeripherals.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Deduplicate and normalize peripheral names.
   */
  private deduplicatePeripherals(access: HardwareAccess[]): string[] {
    // Semantic grouping: merge related peripherals
    const groupMap: Record<string, string> = {
      'i2s': 'I2S', 'imu': 'IMU', 'gyro': 'IMU', 'accel': 'IMU',
      'lcd': 'LCD', 'tft': 'LCD', 'display': 'LCD',
      'spi2': 'SPI', 'spi1': 'SPI', 'spi': 'SPI',
      'i2c2': 'I2C', 'i2c1': 'I2C', 'wire': 'I2C', 'i2c': 'I2C',
      'sensor': 'Sensor', 'sensors': 'Sensor',
      'gpio': 'GPIO',
      'uart': 'UART', 'serial': 'UART',
      'bledevice': 'BLE', 'bluetooth': 'BLE',
      'wifi': 'WiFi',
      'audio': 'Audio',
      'pwr': 'Power',
      'timer': 'Timer',
      'adc': 'ADC', 'dac': 'DAC',
      'dma': 'DMA',
      'rtc': 'RTC',
      'pwm': 'PWM',
    };

    const normalized = new Set<string>();
    for (const a of access) {
      const lower = a.peripheral.toLowerCase();
      const grouped = groupMap[lower] || a.peripheral;
      normalized.add(grouped);
    }

    return Array.from(normalized).sort();
  }
}
