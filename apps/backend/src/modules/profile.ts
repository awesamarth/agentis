import { sql } from 'drizzle-orm'
import type { OperationService } from '../operations'

export async function profileSummary(service: OperationService, ownerId: string) {
  const [row] = await service.db.execute(sql`
    with settled as (
      select o."usdSettledMicros"::numeric as spend,
        (o."settledAt" at time zone 'UTC')::date as day, w."agentId" as agent_id
      from operations o join wallets w on w.id = o."walletId"
      where o."ownerId" = ${ownerId} and o."settledAt" is not null
    ), days as (
      select generate_series((now() at time zone 'UTC')::date - 13,
        (now() at time zone 'UTC')::date, interval '1 day')::date as day
    )
    select json_build_object(
      'totalAgents', (select count(*)::int from agents where "ownerId" = ${ownerId}),
      'activeAgents', (select count(*)::int from agents where "ownerId" = ${ownerId} and mode <> 'paused'),
      'totalSpendMicros', (select coalesce(sum(spend), 0)::text from settled),
      'unpricedPayments', (select count(*)::int from settled where spend is null),
      'daily', (select json_agg(d order by d.date) from (
        select to_char(days.day, 'YYYY-MM-DD') as date, coalesce(sum(s.spend), 0)::text as "spendMicros"
        from days left join settled s on s.day = days.day group by days.day
      ) d),
      'byAgent', coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name, 'spendMicros', a."spendMicros") order by a.spend desc) from (
        select s.agent_id as id, coalesce(a.name, 'Other wallets') as name,
          sum(s.spend)::text as "spendMicros", sum(s.spend) as spend
        from settled s left join agents a on a.id = s.agent_id and a."ownerId" = ${ownerId}
        group by s.agent_id, a.name having sum(s.spend) > 0
      ) a), '[]'::json)
    ) as summary
  `)
  return row!.summary
}
