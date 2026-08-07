import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get(PasswordService);
    await service.onModuleInit();
  });

  it('hashes a password', async () => {
    const hash = await service.hash('MyP@ssword1');
    expect(hash).not.toBe('MyP@ssword1');
    expect(hash.startsWith('$2b$')).toBe(true);
  });

  it('verifies correct password', async () => {
    const hash = await service.hash('MyP@ssword1');
    expect(await service.verify('MyP@ssword1', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await service.hash('MyP@ssword1');
    expect(await service.verify('WrongPassword1!', hash)).toBe(false);
  });

  it('handles null hash (user not found) without throwing', async () => {
    const result = await service.verify('anything', null);
    expect(result).toBe(false);
  });

  it('rejects reused password', async () => {
    const hash = await service.hash('OldP@ssword1');
    await expect(service.assertNotReused('OldP@ssword1', [hash])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows password not in history', async () => {
    const hash = await service.hash('OldP@ssword1');
    await expect(service.assertNotReused('NewP@ssword2!', [hash])).resolves.toBeUndefined();
  });

  it('keeps last 5 hashes in history', () => {
    const history = ['h1', 'h2', 'h3', 'h4', 'h5'];
    const updated = service.buildUpdatedHistory('h6', history);
    expect(updated).toHaveLength(5);
    expect(updated[0]).toBe('h6');
    expect(updated).not.toContain('h5');
  });
});
