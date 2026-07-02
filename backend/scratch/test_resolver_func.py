import socket
from urllib.parse import urlparse, urlunparse

def resolve_db_url(url: str) -> str:
    try:
        scheme_prefix = ""
        temp_url = url
        if "://" in url:
            parts = url.split("://", 1)
            scheme_prefix = parts[0] + "://"
            temp_url = "http://" + parts[1]
            
        parsed = urlparse(temp_url)
        netloc = parsed.netloc
        if "@" in netloc:
            auth, host_port = netloc.split("@", 1)
        else:
            auth = ""
            host_port = netloc
            
        if ":" in host_port:
            host, port = host_port.split(":", 1)
            port_suffix = ":" + port
        else:
            host = host_port
            port_suffix = ""
            
        # Resolve to IPv4 specifically
        addr_info = socket.getaddrinfo(host, None, socket.AF_INET)
        if addr_info:
            ip = addr_info[0][4][0]
            new_netloc = f"{auth}@{ip}{port_suffix}" if auth else f"{ip}{port_suffix}"
            new_parsed = parsed._replace(netloc=new_netloc)
            reconstructed = urlunparse(new_parsed)
            if scheme_prefix:
                reconstructed = scheme_prefix + reconstructed.split("://", 1)[1]
            return reconstructed
    except Exception as exc:
        print(f"DNS lookup resolution bypass skipped: {exc}")
    return url

original = "postgresql+psycopg://postgres.jspkxmjnyenlkxhorzus:Clashofclan%4011@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
resolved = resolve_db_url(original)
print("Original:", original.split("@")[-1])
print("Resolved:", resolved.split("@")[-1])
