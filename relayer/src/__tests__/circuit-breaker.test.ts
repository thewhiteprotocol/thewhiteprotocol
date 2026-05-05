import { CircuitBreaker } from '../circuit-breaker';

describe('CircuitBreaker', () => {
  let dateNow: number;

  beforeEach(() => {
    dateNow = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => dateNow);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const advanceTime = (ms: number) => {
    dateNow += ms;
  };

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getStatus()).toEqual({ name: 'test', state: 'CLOSED', failureCount: 0 });
  });

  it('executes successfully in CLOSED state', async () => {
    const cb = new CircuitBreaker('test');
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(cb.getStatus().state).toBe('CLOSED');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('increments failure count on error', async () => {
    const cb = new CircuitBreaker('test');
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().failureCount).toBe(1);
    expect(cb.getStatus().state).toBe('CLOSED');
  });

  it('opens after failure threshold reached', async () => {
    const cb = new CircuitBreaker('test', 3, 2, 30000);

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');

    expect(cb.getStatus().state).toBe('OPEN');
    expect(cb.getStatus().failureCount).toBe(3);
  });

  it('rejects immediately when OPEN', async () => {
    const cb = new CircuitBreaker('test', 1, 1, 30000);

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('OPEN');

    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow("Circuit breaker 'test' is OPEN");
  });

  it('transitions to HALF_OPEN after timeout', async () => {
    const cb = new CircuitBreaker('test', 1, 1, 30000);

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('OPEN');

    advanceTime(31000);

    // Should now be able to execute (HALF_OPEN)
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(cb.getStatus().state).toBe('CLOSED');
  });

  it('resets to CLOSED after successThreshold successes in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test', 5, 2, 30000);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    }
    expect(cb.getStatus().state).toBe('OPEN');

    // Advance past timeout
    advanceTime(31000);

    // First success in HALF_OPEN
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStatus().state).toBe('HALF_OPEN');

    // Second success closes the breaker
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStatus().state).toBe('CLOSED');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('re-opens immediately on failure in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test', 5, 2, 30000);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    }
    expect(cb.getStatus().state).toBe('OPEN');

    // Advance past timeout
    advanceTime(31000);

    // Failure in HALF_OPEN should re-open immediately
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('OPEN');
  });

  it('resets failure count after successful execution in CLOSED', async () => {
    const cb = new CircuitBreaker('test', 5, 1, 30000);

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().failureCount).toBe(1);

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('uses custom timeoutMs', async () => {
    const cb = new CircuitBreaker('fast', 1, 1, 5000);

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getStatus().state).toBe('OPEN');

    advanceTime(4000);
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('OPEN');

    advanceTime(2000);
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});
