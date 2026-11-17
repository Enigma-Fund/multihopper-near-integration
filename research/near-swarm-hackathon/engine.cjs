// Synthetic local demonstration model. No chain connection or custody signing.
class SwarmDemo {
  constructor() { this.jobs = new Map(); this.invoices = new Map(); }
  create(owner, id, budget, cap) {
    if (!owner || !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || this.jobs.has(id)) throw Error('Choose a unique job ID');
    if (![budget, cap].every(x => typeof x === 'string' && /^[1-9][0-9]{0,17}$/.test(x))) throw Error('Enter positive whole units');
    const total = BigInt(budget), limit = BigInt(cap);
    if (total <= 0n || limit <= 0n || limit > total) throw Error('Use a positive budget and a cap within the budget');
    const job = { owner, id, budget: total, cap: limit, remaining: total, spent: 0n, returned: 0n, status: 'active' };
    this.jobs.set(id, job);
    return job;
  }
  pay(owner, id, invoice, amount) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner || job.status !== 'active') throw Error('Active customer job required');
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(invoice)) throw Error('Enter an invoice ID');
    if (typeof amount !== 'string' || !/^[1-9][0-9]{0,17}$/.test(amount)) throw Error('Enter positive whole units');
    const value = BigInt(amount);
    const key = owner + ':' + invoice;
    const previous = this.invoices.get(key);
    if (previous) {
      if (previous.id !== id || previous.amount !== value) throw Error('Invoice already bound to another payment');
      return job;
    }
    if (value <= 0n || value > job.cap || value > job.remaining) throw Error('Payment exceeds the grant limit or remaining budget');
    job.remaining -= value;
    job.spent += value;
    this.invoices.set(key, { id, amount: value });
    return job;
  }
  fail(owner, id) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw Error('Customer job required');
    if (job.status === 'recovered') return job;
    job.returned = job.remaining;
    job.remaining = 0n;
    job.status = 'recovered';
    return job;
  }
}
if (typeof module !== 'undefined') module.exports = { SwarmDemo };

