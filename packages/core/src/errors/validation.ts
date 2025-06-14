/**
 * @fileoverview Input validation framework for Tari JavaScript SDK
 * 
 * Provides comprehensive validation utilities for wallet inputs with detailed
 * error messages and type-safe validation functions.
 */

import { WalletError, createWalletError } from './wallet-error';
import { WalletErrorCode } from './codes';
import { createEnrichedErrorContext } from './context';

/**
 * Validation result interface
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error details if validation failed */
  error?: string;
  /** Suggested fix if available */
  suggestion?: string;
  /** Validation metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Base validator interface
 */
export interface Validator<T = unknown> {
  /** Validate the input value */
  validate(value: T): ValidationResult;
  /** Get validator name for error messages */
  getName(): string;
}

/**
 * Validation options for customizing behavior
 */
export interface ValidationOptions {
  /** Field name for error messages */
  fieldName?: string;
  /** Whether to throw on validation failure */
  throwOnError?: boolean;
  /** Custom error message */
  customMessage?: string;
  /** Additional context for errors */
  context?: Record<string, unknown>;
}

/**
 * Abstract base validator class
 */
abstract class BaseValidator<T> implements Validator<T> {
  constructor(protected name: string) {}

  abstract validate(value: T): ValidationResult;

  getName(): string {
    return this.name;
  }

  /**
   * Helper to create validation error
   */
  protected createError(
    code: WalletErrorCode,
    message: string,
    suggestion?: string,
    metadata?: Record<string, unknown>
  ): ValidationResult {
    return {
      valid: false,
      error: message,
      suggestion,
      metadata,
    };
  }

  /**
   * Helper to create success result
   */
  protected createSuccess(metadata?: Record<string, unknown>): ValidationResult {
    return {
      valid: true,
      metadata,
    };
  }
}

/**
 * Required field validator
 */
export class RequiredValidator extends BaseValidator<unknown> {
  constructor() {
    super('required');
  }

  validate(value: unknown): ValidationResult {
    if (value === null || value === undefined || value === '') {
      return this.createError(
        WalletErrorCode.RequiredFieldMissing,
        'Field is required',
        'Provide a non-empty value'
      );
    }

    return this.createSuccess();
  }
}

/**
 * String format validator
 */
export class StringFormatValidator extends BaseValidator<string> {
  constructor(
    private pattern: RegExp,
    private errorMessage: string,
    private suggestion?: string
  ) {
    super('string-format');
  }

  validate(value: string): ValidationResult {
    if (typeof value !== 'string') {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        'Value must be a string',
        'Provide a string value'
      );
    }

    if (!this.pattern.test(value)) {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        this.errorMessage,
        this.suggestion
      );
    }

    return this.createSuccess();
  }
}

/**
 * Length validator for strings and arrays
 */
export class LengthValidator extends BaseValidator<string | unknown[]> {
  constructor(
    private minLength?: number,
    private maxLength?: number
  ) {
    super('length');
  }

  validate(value: string | unknown[]): ValidationResult {
    if (typeof value !== 'string' && !Array.isArray(value)) {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        'Value must be a string or array',
        'Provide a string or array value'
      );
    }

    const length = value.length;

    if (this.minLength !== undefined && length < this.minLength) {
      return this.createError(
        WalletErrorCode.InvalidLength,
        `Length must be at least ${this.minLength}, got ${length}`,
        `Provide a value with at least ${this.minLength} characters/items`
      );
    }

    if (this.maxLength !== undefined && length > this.maxLength) {
      return this.createError(
        WalletErrorCode.InvalidLength,
        `Length must be at most ${this.maxLength}, got ${length}`,
        `Provide a value with at most ${this.maxLength} characters/items`
      );
    }

    return this.createSuccess({ length });
  }
}

/**
 * Numeric range validator
 */
export class RangeValidator extends BaseValidator<number | bigint> {
  constructor(
    private min?: number | bigint,
    private max?: number | bigint,
    private inclusive = true
  ) {
    super('range');
  }

  validate(value: number | bigint): ValidationResult {
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        'Value must be a number or bigint',
        'Provide a numeric value'
      );
    }

    if (this.min !== undefined) {
      const isValid = this.inclusive ? value >= this.min : value > this.min;
      if (!isValid) {
        const operator = this.inclusive ? '>=' : '>';
        return this.createError(
          WalletErrorCode.ValueOutOfRange,
          `Value must be ${operator} ${this.min}, got ${value}`,
          `Provide a value ${operator} ${this.min}`
        );
      }
    }

    if (this.max !== undefined) {
      const isValid = this.inclusive ? value <= this.max : value < this.max;
      if (!isValid) {
        const operator = this.inclusive ? '<=' : '<';
        return this.createError(
          WalletErrorCode.ValueOutOfRange,
          `Value must be ${operator} ${this.max}, got ${value}`,
          `Provide a value ${operator} ${this.max}`
        );
      }
    }

    return this.createSuccess();
  }
}

/**
 * Array validator
 */
export class ArrayValidator<T> extends BaseValidator<T[]> {
  constructor(
    private elementValidator?: Validator<T>,
    private minLength?: number,
    private maxLength?: number
  ) {
    super('array');
  }

  validate(value: T[]): ValidationResult {
    if (!Array.isArray(value)) {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        'Value must be an array',
        'Provide an array value'
      );
    }

    // Check length constraints
    const lengthValidator = new LengthValidator(this.minLength, this.maxLength);
    const lengthResult = lengthValidator.validate(value);
    if (!lengthResult.valid) {
      return lengthResult;
    }

    // Validate each element if element validator provided
    if (this.elementValidator) {
      for (let i = 0; i < value.length; i++) {
        const elementResult = this.elementValidator.validate(value[i]);
        if (!elementResult.valid) {
          return this.createError(
            WalletErrorCode.InvalidFormat,
            `Invalid element at index ${i}: ${elementResult.error}`,
            elementResult.suggestion
          );
        }
      }
    }

    return this.createSuccess({ length: value.length });
  }
}

/**
 * Composite validator that combines multiple validators
 */
export class CompositeValidator<T> extends BaseValidator<T> {
  constructor(
    private validators: Validator<T>[],
    private mode: 'all' | 'any' = 'all'
  ) {
    super('composite');
  }

  validate(value: T): ValidationResult {
    const results = this.validators.map(validator => validator.validate(value));

    if (this.mode === 'all') {
      // All validators must pass
      const failedResult = results.find(result => !result.valid);
      if (failedResult) {
        return failedResult;
      }
    } else {
      // At least one validator must pass
      const hasSuccess = results.some(result => result.valid);
      if (!hasSuccess) {
        const errors = results.map(result => result.error).filter(Boolean);
        return this.createError(
          WalletErrorCode.InvalidFormat,
          `All validations failed: ${errors.join(', ')}`,
          'Check input format and try again'
        );
      }
    }

    return this.createSuccess();
  }
}

// Specific validators for Tari wallet operations

/**
 * Tari address validator
 */
export class TariAddressValidator extends BaseValidator<string> {
  private static readonly EMOJI_PATTERN = /^[\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{33}$/u;
  private static readonly BASE58_PATTERN = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  private static readonly HEX_PATTERN = /^[0-9a-fA-F]+$/;
  private static readonly VALID_NETWORKS = ['mainnet', 'testnet', 'nextnet'];

  constructor(private network?: string) {
    super('tari-address');
  }

  validate(value: string): ValidationResult {
    if (typeof value !== 'string') {
      return this.createError(
        WalletErrorCode.InvalidAddress,
        'Address must be a string',
        'Provide a valid Tari address string'
      );
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return this.createError(
        WalletErrorCode.InvalidAddress,
        'Address cannot be empty',
        'Provide a valid Tari address'
      );
    }

    // Check for emoji ID format (exactly 33 emojis from Tari emoji set)
    if (TariAddressValidator.EMOJI_PATTERN.test(trimmedValue)) {
      return this.validateEmojiAddress(trimmedValue);
    }

    // Check for base58 format (52-97 characters for Tari addresses)
    if (TariAddressValidator.BASE58_PATTERN.test(trimmedValue) && 
        trimmedValue.length >= 50 && 
        trimmedValue.length <= 100) {
      return this.validateBase58Address(trimmedValue);
    }

    // Check for hex format (76 or 140 characters for 38 or 70 bytes)
    if (TariAddressValidator.HEX_PATTERN.test(trimmedValue) && 
        (trimmedValue.length === 76 || trimmedValue.length === 140)) {
      return this.validateHexAddress(trimmedValue);
    }

    return this.createError(
      WalletErrorCode.InvalidAddress,
      'Invalid Tari address format',
      'Provide a valid address: 33 emojis (Emoji ID), 50-100 characters (Base58), or 76/140 characters (hex)'
    );
  }

  private validateEmojiAddress(address: string): ValidationResult {
    // Emoji ID: 33 emojis representing network + features + spend key
    // Network validation could be added here if network is specified
    if (this.network && this.isValidNetwork(this.network)) {
      // First emoji represents network - this would need emoji-to-network mapping
      // For now, we just validate the format is correct
    }

    return this.createSuccess({ 
      format: 'emoji',
      length: address.length,
      estimatedBytes: 33
    });
  }

  private validateBase58Address(address: string): ValidationResult {
    // Base58 addresses include network, features, optional view key, spend key, and checksum
    // Actual checksum validation would require the DammSum algorithm implementation
    // For now, we validate the format and length
    
    const estimatedBytes = this.estimateBase58Bytes(address.length);
    const hasViewKey = estimatedBytes >= 70; // 70 bytes = full address with view key
    
    return this.createSuccess({ 
      format: 'base58',
      length: address.length,
      estimatedBytes,
      hasViewKey
    });
  }

  private validateHexAddress(address: string): ValidationResult {
    // Hex addresses: 76 chars (38 bytes) without view key, 140 chars (70 bytes) with view key
    const bytes = address.length / 2;
    const hasViewKey = bytes === 70;
    
    if (bytes !== 38 && bytes !== 70) {
      return this.createError(
        WalletErrorCode.InvalidAddress,
        `Invalid hex address length: ${address.length} characters (${bytes} bytes)`,
        'Hex addresses must be 76 characters (38 bytes) or 140 characters (70 bytes)'
      );
    }

    return this.createSuccess({ 
      format: 'hex',
      length: address.length,
      bytes,
      hasViewKey
    });
  }

  private estimateBase58Bytes(base58Length: number): number {
    // Base58 encoding approximately: bytes * 1.38 = base58Length
    return Math.round(base58Length / 1.38);
  }

  private isValidNetwork(network: string): boolean {
    return TariAddressValidator.VALID_NETWORKS.includes(network.toLowerCase());
  }
}

/**
 * MicroTari amount validator
 */
export class MicroTariValidator extends BaseValidator<string | number | bigint> {
  constructor() {
    super('micro-tari');
  }

  validate(value: string | number | bigint): ValidationResult {
    let amount: bigint;

    // Convert to bigint
    try {
      if (typeof value === 'string') {
        if (!/^\d+$/.test(value.trim())) {
          return this.createError(
            WalletErrorCode.InvalidAmount,
            'Amount must be a positive integer string',
            'Provide a numeric string without decimals (e.g., "1000000")'
          );
        }
        amount = BigInt(value.trim());
      } else if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0) {
          return this.createError(
            WalletErrorCode.InvalidAmount,
            'Amount must be a non-negative integer',
            'Provide a positive integer value'
          );
        }
        amount = BigInt(value);
      } else if (typeof value === 'bigint') {
        amount = value;
      } else {
        return this.createError(
          WalletErrorCode.InvalidAmount,
          'Amount must be a string, number, or bigint',
          'Provide the amount as a numeric value'
        );
      }
    } catch (error) {
      return this.createError(
        WalletErrorCode.InvalidAmount,
        'Invalid amount format',
        'Provide a valid numeric amount'
      );
    }

    // Check for negative amounts
    if (amount < 0n) {
      return this.createError(
        WalletErrorCode.InvalidAmount,
        'Amount cannot be negative',
        'Provide a positive amount'
      );
    }

    // Check for zero amounts in transactions
    if (amount === 0n) {
      return this.createError(
        WalletErrorCode.InvalidAmount,
        'Amount must be greater than zero',
        'Provide an amount greater than 0'
      );
    }

    // Check for reasonable maximum (prevent overflow)
    const MAX_TARI = BigInt('21000000000000000'); // 21M Tari in microTari
    if (amount > MAX_TARI) {
      return this.createError(
        WalletErrorCode.InvalidAmount,
        'Amount exceeds maximum possible value',
        `Provide an amount less than ${MAX_TARI} microTari`
      );
    }

    return this.createSuccess({ amount: amount.toString() });
  }
}

/**
 * Network type validator
 */
export class NetworkTypeValidator extends BaseValidator<string> {
  private static readonly VALID_NETWORKS = ['mainnet', 'testnet', 'nextnet'];

  constructor() {
    super('network-type');
  }

  validate(value: string): ValidationResult {
    if (typeof value !== 'string') {
      return this.createError(
        WalletErrorCode.InvalidNetworkType,
        'Network type must be a string',
        'Provide a valid network type string'
      );
    }

    const network = value.toLowerCase().trim();
    if (!NetworkTypeValidator.VALID_NETWORKS.includes(network)) {
      return this.createError(
        WalletErrorCode.InvalidNetworkType,
        `Invalid network type: ${value}`,
        `Valid networks: ${NetworkTypeValidator.VALID_NETWORKS.join(', ')}`
      );
    }

    return this.createSuccess({ normalizedNetwork: network });
  }
}

/**
 * Seed words validator for BIP39 mnemonic phrases
 */
export class SeedWordsValidator extends BaseValidator<string[]> {
  private static readonly VALID_LENGTHS = [12, 15, 18, 21, 24];
  private static readonly WORD_PATTERN = /^[a-z]+$/;

  constructor() {
    super('seed-words');
  }

  validate(value: string[]): ValidationResult {
    if (!Array.isArray(value)) {
      return this.createError(
        WalletErrorCode.InvalidFormat,
        'Seed words must be an array',
        'Provide an array of seed words'
      );
    }

    // Check valid BIP39 lengths
    if (!SeedWordsValidator.VALID_LENGTHS.includes(value.length)) {
      return this.createError(
        WalletErrorCode.InvalidLength,
        `Seed words must contain 12, 15, 18, 21, or 24 words, got ${value.length}`,
        'Provide a valid BIP39 mnemonic length (12, 15, 18, 21, or 24 words)'
      );
    }

    // Validate each word
    for (let i = 0; i < value.length; i++) {
      const word = value[i];
      
      if (typeof word !== 'string') {
        return this.createError(
          WalletErrorCode.InvalidFormat,
          `Seed word at position ${i + 1} must be a string`,
          'All seed words must be strings'
        );
      }

      const trimmedWord = word.trim().toLowerCase();
      
      if (trimmedWord.length === 0) {
        return this.createError(
          WalletErrorCode.InvalidFormat,
          `Seed word at position ${i + 1} is empty`,
          'All seed words must be non-empty'
        );
      }

      // Check for valid word format (only lowercase letters)
      if (!SeedWordsValidator.WORD_PATTERN.test(trimmedWord)) {
        return this.createError(
          WalletErrorCode.InvalidCharacters,
          `Seed word "${word}" contains invalid characters`,
          'Seed words should only contain lowercase letters (a-z)'
        );
      }

      // Check word length (BIP39 words are typically 3-8 characters)
      if (trimmedWord.length < 3 || trimmedWord.length > 8) {
        return this.createError(
          WalletErrorCode.InvalidLength,
          `Seed word "${word}" has invalid length (${trimmedWord.length} characters)`,
          'BIP39 words are typically 3-8 characters long'
        );
      }
    }

    // Check for duplicate words (not allowed in BIP39)
    const uniqueWords = new Set(value.map(w => w.trim().toLowerCase()));
    if (uniqueWords.size !== value.length) {
      const duplicates = this.findDuplicates(value.map(w => w.trim().toLowerCase()));
      return this.createError(
        WalletErrorCode.InvalidFormat,
        `Duplicate words found: ${duplicates.join(', ')}`,
        'BIP39 seed phrases cannot contain duplicate words'
      );
    }

    return this.createSuccess({ 
      wordCount: value.length,
      entropyBits: this.calculateEntropyBits(value.length),
      isStandardLength: [12, 24].includes(value.length)
    });
  }

  private findDuplicates(words: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    
    for (const word of words) {
      if (seen.has(word)) {
        duplicates.add(word);
      } else {
        seen.add(word);
      }
    }
    
    return Array.from(duplicates);
  }

  private calculateEntropyBits(wordCount: number): number {
    // BIP39 entropy calculation: (wordCount * 11) - (wordCount / 3)
    // Each word encodes 11 bits, minus checksum bits (1 bit per 3 words)
    const totalBits = wordCount * 11;
    const checksumBits = Math.floor(wordCount / 3);
    return totalBits - checksumBits;
  }
}

/**
 * Main validation function that throws WalletError on failure
 */
export function validate<T>(
  value: T,
  validator: Validator<T>,
  options: ValidationOptions = {}
): T {
  const result = validator.validate(value);
  
  if (!result.valid) {
    const fieldName = options.fieldName || 'input';
    const message = options.customMessage || result.error || 'Validation failed';
    
    const context = createEnrichedErrorContext({
      operation: 'validation',
      component: 'validation',
      metadata: {
        validator: validator.getName(),
        fieldName,
        suggestion: result.suggestion,
        validationMetadata: result.metadata,
        ...options.context,
      },
    });

    const error = createWalletError(
      WalletErrorCode.InvalidFormat,
      `${fieldName}: ${message}`,
      context
    );

    if (options.throwOnError !== false) {
      throw error;
    }
  }

  return value;
}

/**
 * Validation utilities
 */
export const Validators = {
  required: () => new RequiredValidator(),
  string: (pattern: RegExp, message: string, suggestion?: string) =>
    new StringFormatValidator(pattern, message, suggestion),
  length: (min?: number, max?: number) => new LengthValidator(min, max),
  range: (min?: number | bigint, max?: number | bigint, inclusive = true) =>
    new RangeValidator(min, max, inclusive),
  array: <T>(elementValidator?: Validator<T>, minLength?: number, maxLength?: number) =>
    new ArrayValidator(elementValidator, minLength, maxLength),
  composite: <T>(validators: Validator<T>[], mode: 'all' | 'any' = 'all') =>
    new CompositeValidator(validators, mode),
  
  // Tari-specific validators
  tariAddress: (network?: string) => new TariAddressValidator(network),
  microTari: () => new MicroTariValidator(),
  networkType: () => new NetworkTypeValidator(),
  seedWords: () => new SeedWordsValidator(),
};

/**
 * Pre-configured validation functions for common use cases
 */
export const validateTariAddress = (address: string, network?: string): string =>
  validate(address, Validators.tariAddress(network), { fieldName: 'address' });

export const validateMicroTari = (amount: string | number | bigint): string | number | bigint =>
  validate(amount, Validators.microTari(), { fieldName: 'amount' });

export const validateNetworkType = (network: string): string =>
  validate(network, Validators.networkType(), { fieldName: 'network' });

export const validateSeedWords = (words: string[]): string[] =>
  validate(words, Validators.seedWords(), { fieldName: 'seedWords' });

export const validateRequired = <T>(value: T, fieldName: string): T =>
  validate<T>(value, Validators.required(), { fieldName });

export const validateStringLength = (
  value: string,
  min?: number,
  max?: number,
  fieldName = 'value'
): string =>
  validate<string>(value, Validators.length(min, max), { fieldName });

/**
 * Batch validation for multiple fields
 */
export function validateFields(
  fields: Array<{
    value: unknown;
    validator: Validator<any>;
    fieldName: string;
    required?: boolean;
  }>
): void {
  const errors: string[] = [];

  for (const field of fields) {
    try {
      if (field.required || (field.value !== null && field.value !== undefined)) {
        validate(field.value, field.validator, {
          fieldName: field.fieldName,
          throwOnError: true,
        });
      }
    } catch (error) {
      if (error instanceof WalletError) {
        errors.push(error.details);
      } else {
        errors.push(`${field.fieldName}: Validation failed`);
      }
    }
  }

  if (errors.length > 0) {
    throw createWalletError(
      WalletErrorCode.InvalidFormat,
      `Validation failed: ${errors.join(', ')}`,
      createEnrichedErrorContext({
        operation: 'batch-validation',
        component: 'validation',
        metadata: { fieldCount: fields.length, errorCount: errors.length },
      })
    );
  }
}
