/**
 * The Lua scripts of the store. A script runs as one command, so each
 * read-then-write below is atomic: no other client sees it half done.
 *
 * `ARGV` values that are an expiry hold an epoch ms, or `'0'` for no TTL.
 */

const SLIDE = `
local function slide(key, at)
	if at ~= '0' then redis.call('PEXPIREAT', key, at) end
end
`;

/**
 * KEYS: thread hash, owner index. ARGV: id, ownerId, at, expireAt, then
 * field/value pairs (`title`, `meta`). Writes the thread and indexes it.
 */
export const CREATE_THREAD = `${SLIDE}
local fields = {'ownerId', ARGV[2], 'messageCount', '0', 'createdAt', ARGV[3], 'updatedAt', ARGV[3]}
for i = 5, #ARGV do fields[#fields + 1] = ARGV[i] end
redis.call('HSET', KEYS[1], unpack(fields))
redis.call('ZADD', KEYS[2], 0, ARGV[1])
slide(KEYS[1], ARGV[4])
return 1
`;

/**
 * KEYS: thread hash, messages sorted set, id index, action index. ARGV:
 * ownerId, updatedAt, expireAt, action key prefix, count, then per message
 * its id, its JSON, its action count and per action its id and its body.
 * Returns the first seq of the range it reserved, or nil when the thread is
 * absent or another owner's. The seq range, the messages and the actions are
 * written in the same step, so a reader never sees a gap.
 */
export const APPEND = `${SLIDE}
if redis.call('HGET', KEYS[1], 'ownerId') ~= ARGV[1] then return false end
local n = tonumber(ARGV[5])
local first = redis.call('HINCRBY', KEYS[1], 'messageCount', n) - n + 1
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[2])
local i = 6
for k = 0, n - 1 do
	local id, json, count = ARGV[i], ARGV[i + 1], tonumber(ARGV[i + 2])
	i = i + 3
	redis.call('ZADD', KEYS[2], first + k, json)
	redis.call('HSET', KEYS[3], id, first + k)
	for _ = 1, count do
		local key = ARGV[4] .. ARGV[i]
		if redis.call('HSETNX', key, 'status', 'pending') == 1 then
			redis.call('HSET', key, 'body', ARGV[i + 1])
			redis.call('SADD', KEYS[4], key)
			slide(key, ARGV[3])
		end
		i = i + 2
	end
end
for j = 1, 4 do slide(KEYS[j], ARGV[3]) end
return first
`;

/**
 * KEYS: thread hash, messages, id index, action index. ARGV: ownerId,
 * summary JSON, updatedAt, expireAt. Returns 1, or nil when the thread is
 * absent or another owner's.
 */
export const SET_SUMMARY = `${SLIDE}
if redis.call('HGET', KEYS[1], 'ownerId') ~= ARGV[1] then return false end
redis.call('HSET', KEYS[1], 'summary', ARGV[2], 'updatedAt', ARGV[3])
for j = 1, 4 do slide(KEYS[j], ARGV[4]) end
return 1
`;

/**
 * KEYS: action hash. ARGV: status, '1' when a result follows, the result
 * JSON. Moves a pending action on; returns 1, or nil when it is absent or
 * no longer pending.
 */
export const UPDATE_ACTION = `
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return false end
redis.call('HSET', KEYS[1], 'status', ARGV[1])
if ARGV[2] == '1' then redis.call('HSET', KEYS[1], 'result', ARGV[3]) end
return 1
`;
