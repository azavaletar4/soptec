-- Comparator helper ONLY. Install in pg_temp within the guarded transaction.
-- No persistent functions, grants or business data are changed by this helper.
-- Canonicalize only ACL members; preserve every other JSON field and array order.
create or replace function pg_temp.olt_canonical_catalog_acl(value jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare result jsonb; member record; canon jsonb; acl_values aclitem[];
begin
 if jsonb_typeof(value)='object' then
  result := '{}'::jsonb;
  for member in select key,val from jsonb_each(value) e(key,val) loop
   if member.key in ('acl','grants') and jsonb_typeof(member.val)='string' then
    acl_values := (member.val #>> '{}')::aclitem[];
    if cardinality(acl_values)=0 then canon := '[]'::jsonb;
    else
    select coalesce(jsonb_agg(jsonb_build_object(
      'grantor',pg_get_userbyid(a.grantor),
      'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by pg_get_userbyid(a.grantor),
       case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
       a.privilege_type,a.is_grantable),'[]'::jsonb)
      into canon from aclexplode(acl_values) a;
    end if;
   else canon := pg_temp.olt_canonical_catalog_acl(member.val);
   end if;
   result := result || jsonb_build_object(member.key,canon);
  end loop;
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(pg_temp.olt_canonical_catalog_acl(v) order by i),'[]'::jsonb)
   into result from jsonb_array_elements(value) with ordinality a(v,i);
  return result;
 end if;
 return value;
end;
$$;
