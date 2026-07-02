import socket
try:
    print("Resolving host...")
    print(socket.gethostbyname("aws-1-us-east-1.pooler.supabase.com"))
    print("Success!")
except Exception as e:
    print("Error:", e)
