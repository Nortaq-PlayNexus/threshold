import http.server, socketserver, mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('font/woff2', '.woff2')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', 8080), H) as s:
    s.serve_forever()
