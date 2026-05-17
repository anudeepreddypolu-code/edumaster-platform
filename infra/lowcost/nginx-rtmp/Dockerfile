FROM alpine:3.20

RUN apk add --no-cache \
  bash \
  ffmpeg \
  gettext \
  nginx \
  nginx-mod-rtmp

RUN mkdir -p /run/nginx /var/www/hls /recordings \
  && chown -R nginx:nginx /run/nginx /var/www/hls /recordings

COPY nginx-rtmp/nginx.conf.template /etc/nginx/nginx.conf.template
COPY nginx-rtmp/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 1935 8080

ENTRYPOINT ["/entrypoint.sh"]
