package main

// APK Signature Scheme v2 (https://source.android.com/docs/security/features/apksigning/v2),
// required for apps that target Android 11 (API 30) or newer.

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"errors"
	"math/big"
	"time"
)

const (
	sigRSAPKCS1SHA256 = 0x0103
	v2BlockID         = 0x7109871a
	chunkSize         = 1 << 20
)

// signingCert recreates the self-signed certificate that cert.go puts into the v1
// signature, so both schemes carry the same certificate.
func signingCert(key *rsa.PrivateKey) ([]byte, error) {
	tmpl := certTemplate()
	return x509.CreateCertificate(rand.Reader, tmpl, tmpl, key.Public(), key)
}

// certTemplate is fixed, so the same key always yields the same certificate – Android
// only accepts app updates signed with an identical certificate.
func certTemplate() *x509.Certificate {
	return &x509.Certificate{
		SerialNumber:       big.NewInt(0x5462c4dd),
		SignatureAlgorithm: x509.SHA256WithRSA,
		Subject:            pkix.Name{CommonName: "Raven", Organization: []string{"Raven"}, Country: []string{"CZ"}},
		NotBefore:          time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		NotAfter:           time.Date(2076, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

func u32(v int) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(v))
	return b
}

func u64(v int) []byte {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, uint64(v))
	return b
}

// lp prefixes data with its uint32 length.
func lp(parts ...[]byte) []byte {
	var body []byte
	for _, p := range parts {
		body = append(body, p...)
	}
	return append(u32(len(body)), body...)
}

func signV2(apk []byte, key *rsa.PrivateKey, cert []byte) ([]byte, error) {
	// locate End of Central Directory (no zip comment is written)
	eocd := len(apk) - 22
	if eocd < 0 || binary.LittleEndian.Uint32(apk[eocd:]) != 0x06054b50 {
		return nil, errors.New("end of central directory not found")
	}
	cdOff := int(binary.LittleEndian.Uint32(apk[eocd+16:]))
	entries, cd, eocdData := apk[:cdOff], apk[cdOff:eocd], apk[eocd:]

	// For digesting, the EOCD's central-directory offset points at the signing block,
	// which begins where the central directory used to begin.
	eocdForDigest := append([]byte{}, eocdData...)
	binary.LittleEndian.PutUint32(eocdForDigest[16:], uint32(cdOff))

	var chunkDigests [][]byte
	for _, sec := range [][]byte{entries, cd, eocdForDigest} {
		for i := 0; i < len(sec); i += chunkSize {
			end := min(i+chunkSize, len(sec))
			h := sha256.New()
			h.Write([]byte{0xa5})
			h.Write(u32(end - i))
			h.Write(sec[i:end])
			chunkDigests = append(chunkDigests, h.Sum(nil))
		}
	}
	top := sha256.New()
	top.Write([]byte{0x5a})
	top.Write(u32(len(chunkDigests)))
	for _, d := range chunkDigests {
		top.Write(d)
	}
	digest := top.Sum(nil)

	pub, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return nil, err
	}
	signedData := append(append(
		lp(lp(u32(sigRSAPKCS1SHA256), lp(digest))), // digests
		lp(lp(cert))...), // certificates
		lp()...) // additional attributes
	h := sha256.Sum256(signedData)
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h[:])
	if err != nil {
		return nil, err
	}
	signer := append(append(lp(signedData),
		lp(lp(u32(sigRSAPKCS1SHA256), lp(sig)))...), // signatures
		lp(pub)...) // public key
	value := lp(lp(signer)) // sequence of signers

	pair := append(u64(4+len(value)), append(u32(v2BlockID), value...)...)
	size := len(pair) + 8 + 16 // pairs + trailing size + magic
	block := append(u64(size), pair...)
	block = append(block, u64(size)...)
	block = append(block, []byte("APK Sig Block 42")...)

	newEOCD := append([]byte{}, eocdData...)
	binary.LittleEndian.PutUint32(newEOCD[16:], uint32(cdOff+len(block)))

	var outBuf bytes.Buffer
	outBuf.Write(entries)
	outBuf.Write(block)
	outBuf.Write(cd)
	outBuf.Write(newEOCD)
	return outBuf.Bytes(), nil
}
