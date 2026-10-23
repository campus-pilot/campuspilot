FROM openpolicyagent/opa:1.20.2@sha256:7b15f9d96345dfa639322ad97f65a0b38260f95efcdd7f5c24e284228708f06c AS policy-check

COPY packages/opa/src/policies /policies
RUN ["/opa", "check", "/policies"]

FROM openpolicyagent/opa:1.20.2@sha256:7b15f9d96345dfa639322ad97f65a0b38260f95efcdd7f5c24e284228708f06c

COPY --from=policy-check /policies /policies

EXPOSE 8181

CMD ["run", "--server", "--addr=0.0.0.0:8181", "/policies"]
