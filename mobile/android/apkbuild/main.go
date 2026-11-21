// Command apkbuild packs Raven's Android app without the Android SDK.
//
// Google's download servers are not always reachable from build machines, so this
// tool assembles the APK itself: the manifest and the icon's resource table are
// encoded with the binres package from golang.org/x/mobile (BSD licence, see
// LICENSE-golang-mobile), files are stored uncompressed and 4-byte aligned, and the
// APK is signed with both the JAR (v1) and the APK Signature Scheme v2.
//
//	go run . -manifest AndroidManifest.xml -dex classes.dex -icon icon.png -key raven-android.pem -out Raven.apk
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"encoding/xml"
	"flag"
	"fmt"
	"log"
	"os"

	"ravenapk/binres"
)

func main() {
	manifest := flag.String("manifest", "AndroidManifest.xml", "plain-text AndroidManifest.xml")
	dex := flag.String("dex", "classes.dex", "compiled classes.dex")
	icon := flag.String("icon", "icon.png", "launcher icon, PNG (192×192 or larger)")
	keyPath := flag.String("key", "raven-android.pem", "RSA signing key (PEM); created if missing – keep it, updates must use the same key")
	out := flag.String("out", "Raven.apk", "output APK")
	flag.Parse()

	key, err := loadOrCreateKey(*keyPath)
	if err != nil {
		log.Fatal(err)
	}
	mf, err := os.ReadFile(*manifest)
	if err != nil {
		log.Fatal(err)
	}
	dexData, err := os.ReadFile(*dex)
	if err != nil {
		log.Fatal(err)
	}
	iconData, err := os.ReadFile(*icon)
	if err != nil {
		log.Fatal(err)
	}

	bxml, err := binres.UnmarshalXML(bytes.NewReader(mf), true)
	if err != nil {
		log.Fatalf("manifest: %v", err)
	}
	pkg, err := bxml.RawValueByName("manifest", xml.Name{Local: "package"})
	if err != nil {
		log.Fatal(err)
	}
	tbl, iconName := binres.NewMipmapTable(pkg)

	var buf bytes.Buffer
	w := NewWriter(&buf, key)
	put := func(name string, data []byte) {
		f, err := w.Create(name)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := f.Write(data); err != nil {
			log.Fatal(err)
		}
	}
	put("classes.dex", dexData)
	put(iconName, iconData)
	arsc, err := tbl.MarshalBinary()
	if err != nil {
		log.Fatal(err)
	}
	put("resources.arsc", arsc)
	bin, err := bxml.MarshalBinary()
	if err != nil {
		log.Fatal(err)
	}
	put("AndroidManifest.xml", bin)
	if err := w.Close(); err != nil {
		log.Fatal(err)
	}

	cert, err := signingCert(key)
	if err != nil {
		log.Fatal(err)
	}
	signed, err := signV2(buf.Bytes(), key, cert)
	if err != nil {
		log.Fatalf("v2 signature: %v", err)
	}
	if err := os.WriteFile(*out, signed, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s: %d bytes, package %s\n", *out, len(signed), pkg)
}

func loadOrCreateKey(path string) (*rsa.PrivateKey, error) {
	if b, err := os.ReadFile(path); err == nil {
		blk, _ := pem.Decode(b)
		if blk == nil {
			return nil, fmt.Errorf("%s: not a PEM file", path)
		}
		if k, err := x509.ParsePKCS1PrivateKey(blk.Bytes); err == nil {
			return k, nil
		}
		k, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
		if err != nil {
			return nil, fmt.Errorf("%s: %v", path, err)
		}
		rk, ok := k.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("%s: not an RSA key", path)
		}
		return rk, nil
	}
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)})
	if err := os.WriteFile(path, pemBytes, 0o600); err != nil {
		return nil, err
	}
	fmt.Printf("new signing key written to %s – keep it safe, app updates must be signed with it\n", path)
	return k, nil
}
