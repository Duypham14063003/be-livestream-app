export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AccountStateFields {
  suspendedAt?: Date | null;
  deletedAt?: Date | null;
  anonymizedAt?: Date | null;
}

export function deriveAccountStatus(account: AccountStateFields): AccountStatus {
  if (account.deletedAt) {
    return 'DELETED';
  }

  if (account.suspendedAt) {
    return 'SUSPENDED';
  }

  return 'ACTIVE';
}

export function isAccountDeleted(account: AccountStateFields): boolean {
  return deriveAccountStatus(account) === 'DELETED';
}

export function isAccountSuspended(account: AccountStateFields): boolean {
  return deriveAccountStatus(account) === 'SUSPENDED';
}

export function isAccountActive(account: AccountStateFields): boolean {
  return deriveAccountStatus(account) === 'ACTIVE';
}
