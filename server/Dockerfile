# Container for the sheet music reader (homr). Used for free hosting on Hugging Face Spaces,
# and works on any host that runs Docker containers.
FROM python:3.12-slim
# Hugging Face Spaces run containers as user 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app
COPY --chown=user requirements.txt .
# Install homr and download its models now, so the first photo doesn't wait for them
RUN pip install --no-cache-dir --user -r requirements.txt && homr --init
COPY --chown=user omr_server.py .
ENV OMR_HOST=0.0.0.0 OMR_PORT=7860
EXPOSE 7860
CMD ["python", "omr_server.py"]
