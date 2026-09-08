import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getValuationSchema } from '../../src/validations/valuation.validation.js';
import { matchRecyclersSchema } from '../../src/validations/recycler.validation.js';
import { getPriceTrendSchema } from '../../src/validations/price.validation.js';

describe('Valuation Validation', () => {
  const schema = getValuationSchema.query;

  it('accepts valid query params', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru', weight: '5' });
    expect(result.success).toBe(true);
    expect(result.data.weight).toBe(5);
  });

  it('rejects missing category', () => {
    const result = schema.safeParse({ location: 'Bengaluru', weight: '5' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive weight', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru', weight: '-1' });
    expect(result.success).toBe(false);
  });

  it('rejects zero weight', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru', weight: '0' });
    expect(result.success).toBe(false);
  });

  it('coerces string weight to number', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru', weight: '3.5' });
    expect(result.success).toBe(true);
    expect(result.data.weight).toBe(3.5);
  });
});

describe('Recycler Matching Validation', () => {
  const schema = matchRecyclersSchema.query;

  it('accepts valid query params', () => {
    const result = schema.safeParse({ category: 'PCB', lat: '12.97', lng: '77.59' });
    expect(result.success).toBe(true);
    expect(result.data.lat).toBe(12.97);
    expect(result.data.lng).toBe(77.59);
    expect(result.data.maxDistanceKm).toBe(50);
  });

  it('accepts custom maxDistanceKm', () => {
    const result = schema.safeParse({ category: 'PCB', lat: '12.97', lng: '77.59', maxDistanceKm: '100' });
    expect(result.success).toBe(true);
    expect(result.data.maxDistanceKm).toBe(100);
  });

  it('rejects missing lat and lng when no location is given', () => {
    const result = schema.safeParse({ category: 'PCB' });
    expect(result.success).toBe(false);
  });

  it('rejects lat without lng', () => {
    const result = schema.safeParse({ category: 'PCB', lat: '12.97' });
    expect(result.success).toBe(false);
  });

  it('rejects lng without lat', () => {
    const result = schema.safeParse({ category: 'PCB', lng: '77.59' });
    expect(result.success).toBe(false);
  });

  it('accepts a location without lat/lng', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Delhi' });
    expect(result.success).toBe(true);
    expect(result.data.location).toBe('Delhi');
    expect(result.data.lat).toBeUndefined();
    expect(result.data.lng).toBeUndefined();
    expect(result.data.maxDistanceKm).toBe(50);
  });

  it('defaults maxDistanceKm to 50', () => {
    const result = schema.safeParse({ category: 'PCB', lat: '12.97', lng: '77.59' });
    expect(result.success).toBe(true);
    expect(result.data.maxDistanceKm).toBe(50);
  });
});

describe('Price Trend Validation', () => {
  const schema = getPriceTrendSchema.query;

  it('accepts valid query params', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru', days: '30' });
    expect(result.success).toBe(true);
    expect(result.data.days).toBe(30);
  });

  it('defaults days to 30', () => {
    const result = schema.safeParse({ category: 'PCB', location: 'Bengaluru' });
    expect(result.success).toBe(true);
    expect(result.data.days).toBe(30);
  });

  it('rejects missing category', () => {
    const result = schema.safeParse({ location: 'Bengaluru' });
    expect(result.success).toBe(false);
  });
});
