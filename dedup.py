import asyncio
from sqlalchemy import select
from app.database import async_session_factory
from app.database.models import WikiPage

async def deduplicate():
    async with async_session_factory() as session:
        result = await session.execute(select(WikiPage))
        pages = result.scalars().all()
        
        # group by (slug, scope_type, scope_id)
        from collections import defaultdict
        groups = defaultdict(list)
        for p in pages:
            groups[(p.slug, p.scope_type, p.scope_id)].append(p)
            
        deleted = 0
        for key, group in groups.items():
            if len(group) > 1:
                # sort by updated_at descending
                group.sort(key=lambda x: x.updated_at, reverse=True)
                print(f"Found {len(group)} duplicates for {key}")
                # keep first (newest), delete rest
                for p in group[1:]:
                    await session.delete(p)
                    deleted += 1
        
        if deleted > 0:
            await session.commit()
        print(f"Deleted {deleted} duplicates.")

if __name__ == "__main__":
    asyncio.run(deduplicate())
